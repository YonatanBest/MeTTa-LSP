const {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    DiagnosticSeverity,
    TextDocumentSyncKind,
    SymbolKind,
    CompletionItemKind,
    ResponseError,
    ErrorCodes,
} = require('vscode-languageserver/node');

const { TextDocument } = require('vscode-languageserver-textdocument');
const Parser = require('tree-sitter');
const Metta = require('tree-sitter-metta');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const connection = createConnection(ProposedFeatures.all);

const documents = new TextDocuments(TextDocument);
const parser = new Parser();
parser.setLanguage(Metta);

const globalIndex = new Map();

// Store workspace folders for reference finding
let workspaceFolders = [];
let hasWorkspaceFolderCapability = false;

// Parse cache: uri -> { tree, content, timestamp, usageIndex, oldTree }
// usageIndex: symbolName -> [ranges]
// oldTree: for incremental parsing
const parseCache = new Map();

// Scope tree: uri -> Map<nodeId, { parent, children, symbols: Set<symbolName>, startLine, endLine }>
// For better semantic scope precision
const scopeTrees = new Map();

// Built-in MeTTa symbols that should not be renamed
const BUILTIN_SYMBOLS = new Set([
    'if', 'let', 'let*', 'match', 'case', 'collapse', 'superpose',
    'Cons', 'Nil', 'True', 'False', 'empty', 'Error',
    '=', ':', '->', '!', '&', '|', 'not', 'and', 'or'
]);

function uriToPath(uri) {
    try {
        const url = new URL(uri);
        if (url.protocol === 'file:') {
            let decodedPath = decodeURIComponent(url.pathname);
            if (process.platform === 'win32' && decodedPath.startsWith('/')) {
                decodedPath = decodedPath.substring(1);
            }
            return decodedPath;
        }
    } catch (e) {
        connection.console.error(`Failed to convert URI to path: ${uri}`);
    }
    return null;
}

// Normalize URI to ensure consistent format (decode percent-encoded characters like %3A -> :)
function normalizeUri(uri) {
    return decodeURIComponent(uri);
}

const queriesPath = path.resolve(__dirname, '../../grammar/queries/metta/highlights.scm');
let highlightQuery;
try {
    const queryContent = fs.readFileSync(queriesPath, 'utf8');
    highlightQuery = new Parser.Query(Metta, queryContent);
} catch (e) {
    console.error(`Failed to load highlights.scm from ${queriesPath}`, e);
}

const symbolQuery = new Parser.Query(Metta, `
  (list
    head: (atom (symbol) @op (#any-of? @op "=" ":"))
    argument: (list head: (atom (symbol) @name)))
  
  (list
    head: (atom (symbol) @op (#any-of? @op "=" ":"))
    argument: (atom (symbol) @name))
`);

// Query for all symbol usages (for references)
const usageQuery = new Parser.Query(Metta, `
  (symbol) @symbol
  (variable) @symbol
`);

// Enhanced query for MeTTa idioms: ->, type declarations, macros, etc.
const enhancedSymbolQuery = new Parser.Query(Metta, `
  ; Standard definitions (= and :)
  (list
    head: (atom (symbol) @op (#any-of? @op "=" ":"))
    argument: (list head: (atom (symbol) @name)))
  
  (list
    head: (atom (symbol) @op (#any-of? @op "=" ":"))
    argument: (atom (symbol) @name))
  
  ; Arrow function definitions (->)
  (list
    head: (atom (symbol) @op (#eq? @op "->"))
    argument: (list head: (atom (symbol) @name)))
  
  (list
    head: (atom (symbol) @op (#eq? @op "->"))
    argument: (atom (symbol) @name))
  
  ; Type declarations in various forms
  (list
    head: (atom (symbol) @name)
    argument: (list head: (atom (symbol) @type (#eq? @type ":"))))
  
  ; Macro definitions
  (list
    head: (atom (symbol) @op (#any-of? @op "macro" "defmacro"))
    argument: (list head: (atom (symbol) @name)))
`);

// Query for scope boundaries (let, let*, match, case, etc.)
const scopeQuery = new Parser.Query(Metta, `
  (list
    head: (atom (symbol) @scope (#any-of? @scope "let" "let*" "match" "case" "if" "->")))
  @scope_node
`);

// Build formal scope tree for better semantic precision
function buildScopeTree(uri, tree) {
    const scopeTree = new Map();
    const rootScope = { parent: null, children: [], symbols: new Set(), startLine: 0, endLine: Infinity, nodeId: 'root' };
    scopeTree.set('root', rootScope);
    
    // Find all scope boundaries
    const matches = scopeQuery.matches(tree.rootNode);
    const scopes = [];
    
    for (const match of matches) {
        const scopeNode = match.captures.find(c => c.name === 'scope_node')?.node;
        if (scopeNode) {
            scopes.push({
                node: scopeNode,
                startLine: scopeNode.startPosition.row,
                endLine: scopeNode.endPosition.row,
                id: `${scopeNode.startPosition.row}:${scopeNode.startPosition.column}`
            });
        }
    }
    
    // Build hierarchical scope structure
    scopes.sort((a, b) => {
        if (a.startLine !== b.startLine) return a.startLine - b.startLine;
        return a.node.startPosition.column - b.node.startPosition.column;
    });
    
    const scopeStack = [rootScope];
    
    for (const scope of scopes) {
        // Pop scopes that have ended
        while (scopeStack.length > 1 && scopeStack[scopeStack.length - 1].endLine < scope.startLine) {
            scopeStack.pop();
        }
        
        const parent = scopeStack[scopeStack.length - 1];
        const newScope = {
            parent: parent,
            children: [],
            symbols: new Set(),
            startLine: scope.startLine,
            endLine: scope.endLine,
            nodeId: scope.id
        };
        
        parent.children.push(newScope);
        scopeTree.set(scope.id, newScope);
        scopeStack.push(newScope);
    }
    
    // Populate symbols in each scope by finding definitions within scope boundaries
    const symbolMatches = symbolQuery.matches(tree.rootNode);
    for (const match of symbolMatches) {
        const nameNode = match.captures.find(c => c.name === 'name')?.node;
        if (nameNode) {
            const symbolLine = nameNode.startPosition.row;
            const symbolName = nameNode.text;
            
            // Find the innermost scope containing this symbol
            function findScopeForLine(scope, line) {
                if (line < scope.startLine || line > scope.endLine) {
                    return null;
                }
                
                for (const child of scope.children) {
                    const found = findScopeForLine(child, line);
                    if (found) return found;
                }
                
                return scope;
            }
            
            const containingScope = findScopeForLine(rootScope, symbolLine);
            if (containingScope) {
                containingScope.symbols.add(symbolName);
            }
        }
    }
    
    scopeTrees.set(uri, scopeTree);
    return scopeTree;
}

// Enhanced function to get or parse file with caching and incremental parsing
function getOrParseFile(uri, content, oldContent = null) {
    const filePath = uriToPath(uri);
    if (!filePath) return null;
    
    let stats = null;
    try {
        stats = fs.statSync(filePath);
    } catch (e) {
        // File doesn't exist or can't be accessed
        return null;
    }
    
    const cached = parseCache.get(uri);
    
    // Try incremental parsing if we have old tree and content
    if (cached && oldContent !== null && cached.oldTree) {
        try {
            const edits = [];
            // Simple edit detection: if content changed, create edit
            if (cached.content !== content) {
                // For now, fall back to full parse, but structure is ready for incremental
                // In future: compute actual text edits and use tree.edit()
            }
            
            // If we can use incremental update:
            // cached.oldTree.edit(edits);
            // const newTree = parser.parse(content, cached.oldTree);
            // But for now, we'll do full parse for simplicity
        } catch (e) {
            // Fall back to full parse on error
        }
    }
    
    // Check if cache is still valid
    if (cached && cached.timestamp >= stats.mtimeMs && cached.content === content) {
        return cached;
    }
    
    // Parse and cache (full parse for now, incremental can be added later)
    const oldTree = cached?.tree || null;
    const tree = parser.parse(content);
    const usageIndex = new Map();
    
    // Build usage index for fast lookup
    const matches = usageQuery.matches(tree.rootNode);
    for (const match of matches) {
        const symbolNode = match.captures.find(c => c.name === 'symbol')?.node;
        if (symbolNode) {
            const name = symbolNode.text;
            if (!usageIndex.has(name)) {
                usageIndex.set(name, []);
            }
            usageIndex.get(name).push({
                start: { 
                    line: symbolNode.startPosition.row, 
                    character: symbolNode.startPosition.column 
                },
                end: { 
                    line: symbolNode.endPosition.row, 
                    character: symbolNode.endPosition.column 
                }
            });
        }
    }
    
    // Build scope tree for better semantic precision
    buildScopeTree(uri, tree);
    
    const cacheEntry = {
        tree,
        content,
        timestamp: stats.mtimeMs,
        usageIndex,
        oldTree // Store for incremental parsing
    };
    
    parseCache.set(uri, cacheEntry);
    return cacheEntry;
}

// Enhanced symbol kind detection
function detectSymbolKind(nameNode, opNode, context) {
    const op = opNode.text;
    const name = nameNode.text;
    const contextStr = context.toLowerCase();
    
    // Type declarations
    if (op === ':') {
        return SymbolKind.Interface;
    }
    
    // Function definitions
    if (op === '=') {
        // Check for predicates (often end with ? or start with is-)
        if (name.endsWith('?') || name.startsWith('is-') || name.startsWith('has-')) {
            return SymbolKind.Boolean; // Use Boolean for predicates
        }
        return SymbolKind.Function;
    }
    
    // Arrow functions
    if (op === '->') {
        return SymbolKind.Function;
    }
    
    // Macros
    if (contextStr.includes('macro') || contextStr.includes('defmacro')) {
        return SymbolKind.Constant; // Use Constant for macros
    }
    
    // Default to Function
    return SymbolKind.Function;
}

function indexFile(uri, content) {
    const tree = parser.parse(content);
    const matches = symbolQuery.matches(tree.rootNode);
    
    // Also check enhanced query for better symbol detection
    const enhancedMatches = enhancedSymbolQuery.matches(tree.rootNode);

    for (const [name, symbols] of globalIndex.entries()) {
        const filtered = symbols.filter(s => s.uri !== uri);
        if (filtered.length === 0) {
            globalIndex.delete(name);
        } else {
            globalIndex.set(name, filtered);
        }
    }

    for (const match of matches) {
        const nameNode = match.captures.find(c => c.name === 'name')?.node;
        const opNode = match.captures.find(c => c.name === 'op')?.node;

        if (nameNode && opNode) {
            const name = nameNode.text;
            // Use enhanced symbol kind detection
            let parent = nameNode.parent;
            while (parent && parent.type !== 'list') parent = parent.parent;
            const context = parent ? parent.text : name;
            const kind = detectSymbolKind(nameNode, opNode, context);

            const entry = {
                uri,
                kind,
                context,
                op: opNode.text,
                range: {
                    start: { line: nameNode.startPosition.row, character: nameNode.startPosition.column },
                    end: { line: nameNode.endPosition.row, character: nameNode.endPosition.column },
                }
            };

            const existing = globalIndex.get(name) || [];
            existing.push(entry);
            globalIndex.set(name, existing);
        }
    }
    
    // Process enhanced matches for additional symbol types
    for (const match of enhancedMatches) {
        const nameNode = match.captures.find(c => c.name === 'name')?.node;
        const opNode = match.captures.find(c => c.name === 'op')?.node;
        
        if (nameNode) {
            const name = nameNode.text;
            const op = opNode ? opNode.text : null;
            
            // Skip if already indexed by standard query
            const existing = globalIndex.get(name);
            if (existing && existing.some(e => e.uri === uri && 
                e.range.start.line === nameNode.startPosition.row &&
                e.range.start.character === nameNode.startPosition.column)) {
                continue;
            }
            
            let parent = nameNode.parent;
            while (parent && parent.type !== 'list') parent = parent.parent;
            const context = parent ? parent.text : name;
            
            // Determine kind based on context
            let kind = SymbolKind.Function;
            if (op === ':') {
                kind = SymbolKind.Interface;
            } else if (op === '->') {
                kind = SymbolKind.Function;
            } else if (context.toLowerCase().includes('macro')) {
                kind = SymbolKind.Constant;
            } else {
                kind = detectSymbolKind(nameNode, opNode || { text: '=' }, context);
            }
            
            const entry = {
                uri,
                kind,
                context,
                op: op || '=',
                range: {
                    start: { line: nameNode.startPosition.row, character: nameNode.startPosition.column },
                    end: { line: nameNode.endPosition.row, character: nameNode.endPosition.column },
                }
            };
            
            const existingEntries = globalIndex.get(name) || [];
            existingEntries.push(entry);
            globalIndex.set(name, existingEntries);
        }
    }
}

async function scanWorkspace(folders) {
    for (const folder of folders) {
        const rootPath = uriToPath(folder.uri);
        if (!rootPath) continue;

        connection.console.log(`Scanning workspace folder: ${rootPath}`);
        crawlDirectory(rootPath);
    }
}

function crawlDirectory(dir) {
    try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                if (file !== 'node_modules' && file !== '.git' && file !== 'vscode-metta') {
                    crawlDirectory(fullPath);
                }
            } else if (file.endsWith('.metta')) {
                const content = fs.readFileSync(fullPath, 'utf8');
                const uri = normalizeUri(`file:///${fullPath.replace(/\\/g, '/')}`);
                indexFile(uri, content);
            }
        }
    } catch (e) {
        connection.console.error(`Error crawling directory ${dir}: ${e.message}`);
    }
}

connection.onInitialize(async (params) => {
    const capabilities = params.capabilities;

    // Does the client support the `workspace/workspaceFolders` capability?
    hasWorkspaceFolderCapability = !!(
        capabilities.workspace && !!capabilities.workspace.workspaceFolders
    );

    connection.console.log('MeTTa LSP Server Initialized');
    if (params.workspaceFolders) {
        workspaceFolders = params.workspaceFolders;
        setTimeout(() => scanWorkspace(params.workspaceFolders), 0);
    }

    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            workspace: {
                workspaceFolders: {
                    supported: true
                }
            },
            semanticTokensProvider: {
                legend: {
                    tokenTypes: ['comment', 'string', 'keyword', 'number', 'operator', 'variable', 'function', 'regexp', 'type', 'boolean', 'punctuation', 'parameter', 'property'],
                    tokenModifiers: []
                },
                full: true
            },
            documentSymbolProvider: true,
            definitionProvider: true,
            referencesProvider: true,
            renameProvider: {
                prepareProvider: true
            },
            hoverProvider: true,
            signatureHelpProvider: {
                triggerCharacters: ['(', ' ']
            },
            completionProvider: {
                resolveProvider: true
            }
        },
    };
});

connection.onHover((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    const offset = document.offsetAt(params.position);
    const tree = parser.parse(document.getText());
    const nodeAtCursor = tree.rootNode.descendantForIndex(offset);
    if (!nodeAtCursor || (nodeAtCursor.type !== 'symbol' && nodeAtCursor.type !== 'variable')) return null;
    const symbolName = nodeAtCursor.text;
    const entries = globalIndex.get(symbolName);
    if (entries) {
        const bestMatch = entries.find(s => s.op === ':' && s.uri === params.textDocument.uri)
            || entries.find(s => s.op === ':')
            || entries.find(s => s.uri === params.textDocument.uri)
            || entries[0];
        return { contents: { kind: 'markdown', value: `\`\`\`metta\n${bestMatch.context}\n\`\`\`` } };
    }
    return null;
});

connection.onSignatureHelp((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    const offset = document.offsetAt(params.position);
    const tree = parser.parse(document.getText());

    let node = tree.rootNode.descendantForIndex(offset);

    while (node && node.type !== 'list') {
        node = node.parent;
    }

    if (!node) return null;

    const headNode = node.childForFieldName('head');
    if (!headNode) return null;

    const headName = headNode.text;
    const entries = globalIndex.get(headName);
    if (!entries) return null;

    const signatures = entries
        .filter(s => s.op === ':')
        .map(s => {
            const label = s.context;
            const parameters = [];

            const sigTree = parser.parse(label);
            let arrowNode = null;

            function findArrow(n) {
                if (n.type === 'list') {
                    const head = n.childForFieldName('head');
                    if (head && head.text === '->') {
                        arrowNode = n;
                        return;
                    }
                }
                for (let i = 0; i < n.childCount; i++) {
                    findArrow(n.child(i));
                    if (arrowNode) return;
                }
            }
            findArrow(sigTree.rootNode);

            if (arrowNode) {
                const children = arrowNode.children.filter(c => c.isNamed && c.text !== '->');
                if (children.length > 1) {
                    // In (-> Arg1 Arg2 ... Ret), all but the last are parameters
                    const paramNodes = children.slice(0, -1);
                    for (const p of paramNodes) {
                        parameters.push({
                            label: [p.startIndex, p.endIndex]
                        });
                    }
                }
            }

            return {
                label,
                documentation: {
                    kind: 'markdown',
                    value: `Defined in [${path.basename(s.uri)}](${s.uri})`
                },
                parameters
            };
        });

    if (signatures.length === 0) return null;


    let activeParameter = 0;
    let current = node.firstChild;
    while (current && current.endIndex < offset) {
        if (current.isNamed && current !== headNode) {
            activeParameter++;
        }
        current = current.nextSibling;
    }

    return {
        signatures,
        activeSignature: 0,
        activeParameter: activeParameter
    };
});

connection.onDefinition((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    const offset = document.offsetAt(params.position);
    const tree = parser.parse(document.getText());
    const nodeAtCursor = tree.rootNode.descendantForIndex(offset);
    if (!nodeAtCursor || (nodeAtCursor.type !== 'symbol' && nodeAtCursor.type !== 'variable')) return null;
    const symbolName = nodeAtCursor.text;
    const entries = globalIndex.get(symbolName);
    if (entries) {
        return entries.map(s => ({ uri: s.uri, range: s.range }));
    }
    return null;
});

// Improved deduplication with better comparison
function isRangeEqual(range1, range2) {
    return range1.start.line === range2.start.line &&
           range1.start.character === range2.start.character &&
           range1.end.line === range2.end.line &&
           range1.end.character === range2.end.character;
}

function isReferenceDuplicate(ref, references) {
    return references.some(existing => 
        existing.uri === ref.uri && isRangeEqual(existing.range, ref.range)
    );
}

// Enhanced scoping: check if symbol is shadowed using formal scope tree
function isSymbolShadowed(node, symbolName, tree, uri) {
    const scopeTree = scopeTrees.get(uri);
    if (!scopeTree) {
        // Fall back to basic heuristic if scope tree not available
        return isSymbolShadowedBasic(node, symbolName, tree);
    }
    
    // Find the scope containing this node
    const nodeLine = node.startPosition.row;
    let containingScope = scopeTree.get('root');
    
    // Find the innermost scope containing this node
    function findContainingScope(scope, line) {
        for (const child of scope.children) {
            if (line >= child.startLine && line <= child.endLine) {
                const deeper = findContainingScope(child, line);
                return deeper || child;
            }
        }
        return null;
    }
    
    const foundScope = findContainingScope(containingScope, nodeLine);
    if (foundScope) {
        containingScope = foundScope;
    }
    
    // Check if any parent scope defines this symbol
    let currentScope = containingScope;
    while (currentScope) {
        if (currentScope.symbols.has(symbolName)) {
            // Check if definition is before usage
            const defs = globalIndex.get(symbolName) || [];
            for (const def of defs) {
                if (def.uri === uri) {
                    const defLine = def.range.start.line;
                    if (defLine >= currentScope.startLine && defLine <= currentScope.endLine &&
                        defLine < nodeLine) {
                        return true; // Shadowed
                    }
                }
            }
        }
        currentScope = currentScope.parent;
    }
    
    return false;
}

// Basic scoping: check if symbol is shadowed by a local definition (fallback)
function isSymbolShadowedBasic(node, symbolName, tree) {
    // Walk up the tree to find enclosing scopes (let, match, etc.)
    let current = node.parent;
    while (current) {
        if (current.type === 'list') {
            const head = current.firstChild;
            if (head && head.type === 'atom') {
                const headSymbol = head.firstChild;
                if (headSymbol && (headSymbol.text === 'let' || headSymbol.text === 'let*' || headSymbol.text === 'match')) {
                    // Check if this scope defines the symbol
                    const scopeMatches = symbolQuery.matches(current);
                    for (const match of scopeMatches) {
                        const nameNode = match.captures.find(c => c.name === 'name')?.node;
                        if (nameNode && nameNode.text === symbolName) {
                            // Check if this definition is before our usage
                            if (nameNode.startPosition.row < node.startPosition.row ||
                                (nameNode.startPosition.row === node.startPosition.row &&
                                 nameNode.startPosition.column < node.startPosition.column)) {
                                return true; // Shadowed
                            }
                        }
                    }
                }
            }
        }
        current = current.parent;
    }
    return false;
}

// Helper function to find all references to a symbol across all files (optimized with cache)
function findAllReferences(symbolName, includeDeclaration = true, sourceUri = null, sourcePosition = null) {
    const references = [];
    const seenKeys = new Set(); // For better deduplication
    
    // Get all definition locations from the index
    const definitions = globalIndex.get(symbolName) || [];
    if (includeDeclaration) {
        for (const def of definitions) {
            const normalizedDefUri = normalizeUri(def.uri);
            const key = `${normalizedDefUri}:${def.range.start.line}:${def.range.start.character}`;
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                references.push({ uri: normalizedDefUri, range: def.range });
            }
        }
    }
    
    // Find all usages in all indexed files
    const allUris = new Set();
    for (const def of definitions) {
        allUris.add(def.uri);
    }
    
    // Also search in all workspace files
    for (const folder of workspaceFolders) {
        const rootPath = uriToPath(folder.uri);
        if (rootPath) {
            findAllMettaFiles(rootPath, allUris);
        }
    }
    
    // Search for usages in each file (using cache)
    for (const uri of allUris) {
        const normalizedFileUri = normalizeUri(uri);
        const filePath = uriToPath(normalizedFileUri);
        if (!filePath || !fs.existsSync(filePath)) continue;
        
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const cached = getOrParseFile(normalizedFileUri, content);
            
            if (cached && cached.usageIndex.has(symbolName)) {
                const ranges = cached.usageIndex.get(symbolName);
                for (const range of ranges) {
                    const key = `${normalizedFileUri}:${range.start.line}:${range.start.character}`;
                    if (!seenKeys.has(key)) {
                        seenKeys.add(key);
                        references.push({ uri: normalizedFileUri, range });
                    }
                }
            }
        } catch (e) {
            connection.console.error(`Error reading file ${filePath}: ${e.message}`);
        }
    }
    
    // Also check open documents (using cache when possible)
    for (const document of documents.all()) {
        const normalizedDocUri = normalizeUri(document.uri);
        if (!allUris.has(normalizedDocUri)) {
            try {
                const content = document.getText();
                const cached = getOrParseFile(normalizedDocUri, content);
                
                if (cached && cached.usageIndex.has(symbolName)) {
                    const ranges = cached.usageIndex.get(symbolName);
                    for (const range of ranges) {
                        const key = `${normalizedDocUri}:${range.start.line}:${range.start.character}`;
                        if (!seenKeys.has(key)) {
                            seenKeys.add(key);
                            references.push({ uri: normalizedDocUri, range });
                        }
                    }
                }
            } catch (e) {
                connection.console.error(`Error parsing document ${normalizedDocUri}: ${e.message}`);
            }
        }
    }
    
    // If we have source context, filter out shadowed references using formal scope tree
    if (sourceUri && sourcePosition) {
        const sourceDoc = documents.get(sourceUri);
        if (sourceDoc) {
            const cached = getOrParseFile(sourceUri, sourceDoc.getText());
            const sourceTree = cached ? cached.tree : parser.parse(sourceDoc.getText());
            const sourceOffset = sourceDoc.offsetAt(sourcePosition);
            const sourceNode = sourceTree.rootNode.descendantForIndex(sourceOffset);
            
            if (sourceNode) {
                // Filter references that might be shadowed (enhanced check with scope tree)
                return references.filter(ref => {
                    if (ref.uri === sourceUri) {
                        const refDoc = documents.get(ref.uri) || sourceDoc;
                        const refCached = getOrParseFile(ref.uri, refDoc.getText());
                        const refTree = refCached ? refCached.tree : parser.parse(refDoc.getText());
                        const refOffset = refDoc.offsetAt(ref.range.start);
                        const refNode = refTree.rootNode.descendantForIndex(refOffset);
                        if (refNode && isSymbolShadowed(refNode, symbolName, refTree, ref.uri)) {
                            return false;
                        }
                    }
                    return true;
                });
            }
        }
    }
    
    return references;
}

// Helper to find all .metta files recursively
function findAllMettaFiles(dir, uriSet) {
    try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                if (file !== 'node_modules' && file !== '.git' && file !== 'vscode-metta') {
                    findAllMettaFiles(fullPath, uriSet);
                }
            } else if (file.endsWith('.metta')) {
                const uri = normalizeUri(`file:///${fullPath.replace(/\\/g, '/')}`);
                uriSet.add(uri);
            }
        }
    } catch (e) {
        connection.console.error(`Error finding metta files in ${dir}: ${e.message}`);
    }
}

connection.onReferences((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    const offset = document.offsetAt(params.position);
    const tree = parser.parse(document.getText());
    const nodeAtCursor = tree.rootNode.descendantForIndex(offset);
    if (!nodeAtCursor || (nodeAtCursor.type !== 'symbol' && nodeAtCursor.type !== 'variable')) return [];
    const symbolName = nodeAtCursor.text;
    return findAllReferences(symbolName, params.context?.includeDeclaration !== false, params.textDocument.uri, params.position);
});

// Validate rename: check for conflicts and built-ins
function validateRename(symbolName, newName) {
    // Check if renaming a built-in
    if (BUILTIN_SYMBOLS.has(symbolName)) {
        return {
            valid: false,
            message: `Cannot rename built-in symbol: ${symbolName}`
        };
    }
    
    // Check if new name is a built-in
    if (BUILTIN_SYMBOLS.has(newName)) {
        return {
            valid: false,
            message: `Cannot rename to built-in symbol: ${newName}`
        };
    }
    
    // Check if new name conflicts with existing symbol
    const existingDefs = globalIndex.get(newName);
    if (existingDefs && existingDefs.length > 0) {
        // Check if it's the same symbol (self-rename)
        const currentDefs = globalIndex.get(symbolName);
        const isSelfRename = currentDefs && currentDefs.length === existingDefs.length &&
            currentDefs.every((def, i) => 
                def.uri === existingDefs[i].uri && 
                isRangeEqual(def.range, existingDefs[i].range)
            );
        
        if (!isSelfRename) {
            return {
                valid: false,
                message: `Symbol "${newName}" already exists. Rename would create a conflict.`
            };
        }
    }
    
    // Validate new name format (basic check)
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(newName) && !/^[=:->!&|]+$/.test(newName)) {
        return {
            valid: false,
            message: `Invalid symbol name: ${newName}`
        };
    }
    
    return { valid: true };
}

connection.onRenameRequest((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    const offset = document.offsetAt(params.position);
    const tree = parser.parse(document.getText());
    const nodeAtCursor = tree.rootNode.descendantForIndex(offset);
    if (!nodeAtCursor || (nodeAtCursor.type !== 'symbol' && nodeAtCursor.type !== 'variable')) return null;
    const symbolName = nodeAtCursor.text;
    const newName = params.newName;
    
    if (symbolName === newName) {
        return null;
    }
    
    // Validate rename
    const validation = validateRename(symbolName, newName);
    if (!validation.valid) {
        throw new ResponseError(ErrorCodes.InvalidRequest, validation.message);
    }
    
    // Find all references (with source context for better scoping)
    const references = findAllReferences(symbolName, true, params.textDocument.uri, params.position);
    
    if (references.length === 0) {
        return null;
    }
    
    // Create workspace edit with all changes
    const changes = {};
    for (const ref of references) {
        const normalizedUri = normalizeUri(ref.uri);
        if (!changes[normalizedUri]) {
            changes[normalizedUri] = [];
        }
        changes[normalizedUri].push({
            range: ref.range,
            newText: newName
        });
    }
    
    return { changes };
});

connection.onPrepareRename((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    const offset = document.offsetAt(params.position);
    const tree = parser.parse(document.getText());
    const nodeAtCursor = tree.rootNode.descendantForIndex(offset);
    if (!nodeAtCursor || (nodeAtCursor.type !== 'symbol' && nodeAtCursor.type !== 'variable')) return null;
    
    const symbolName = nodeAtCursor.text;
    
    // Check if it's a built-in (can't rename)
    if (BUILTIN_SYMBOLS.has(symbolName)) {
        throw new ResponseError(ErrorCodes.InvalidRequest, `Cannot rename built-in symbol: ${symbolName}`);
    }
    
    const range = {
        start: { 
            line: nodeAtCursor.startPosition.row, 
            character: nodeAtCursor.startPosition.column 
        },
        end: { 
            line: nodeAtCursor.endPosition.row, 
            character: nodeAtCursor.endPosition.column 
        }
    };
    
    // Get reference count for preview
    const references = findAllReferences(symbolName, true, params.textDocument.uri, params.position);
    const placeholder = `${symbolName} (${references.length} reference${references.length !== 1 ? 's' : ''})`;
    
    return { range, placeholder };
});

connection.onDocumentSymbol((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    const tree = parser.parse(document.getText());
    const matches = symbolQuery.matches(tree.rootNode);
    const symbols = [];
    const seen = new Set(); // Avoid duplicates
    
    for (const match of matches) {
        const nameNode = match.captures.find(c => c.name === 'name')?.node;
        const opNode = match.captures.find(c => c.name === 'op')?.node;
        if (nameNode && opNode) {
            const key = `${nameNode.startPosition.row}:${nameNode.startPosition.column}`;
            if (!seen.has(key)) {
                seen.add(key);
                let parent = nameNode.parent;
                while (parent && parent.type !== 'list') parent = parent.parent;
                const context = parent ? parent.text : nameNode.text;
                const kind = detectSymbolKind(nameNode, opNode, context);
                
                symbols.push({
                    name: nameNode.text,
                    kind: kind,
                    location: { uri: params.textDocument.uri, range: { start: { line: nameNode.startPosition.row, character: nameNode.startPosition.column }, end: { line: nameNode.endPosition.row, character: nameNode.endPosition.column } } }
                });
            }
        }
    }
    
    // Also include enhanced matches
    const enhancedMatches = enhancedSymbolQuery.matches(tree.rootNode);
    for (const match of enhancedMatches) {
        const nameNode = match.captures.find(c => c.name === 'name')?.node;
        if (nameNode) {
            const key = `${nameNode.startPosition.row}:${nameNode.startPosition.column}`;
            if (!seen.has(key)) {
                seen.add(key);
                const opNode = match.captures.find(c => c.name === 'op')?.node;
                let parent = nameNode.parent;
                while (parent && parent.type !== 'list') parent = parent.parent;
                const context = parent ? parent.text : nameNode.text;
                const kind = detectSymbolKind(nameNode, opNode || { text: '=' }, context);
                
                symbols.push({
                    name: nameNode.text,
                    kind: kind,
                    location: { uri: params.textDocument.uri, range: { start: { line: nameNode.startPosition.row, character: nameNode.startPosition.column }, end: { line: nameNode.endPosition.row, character: nameNode.endPosition.column } } }
                });
            }
        }
    }
    
    return symbols;
});

connection.onCompletion((params) => {
    const keywords = ['if', 'let', 'let*', 'match', 'case', 'collapse', 'superpose', 'Cons', 'Nil', 'True', 'False', 'empty', 'Error']
        .map(k => ({ label: k, kind: CompletionItemKind.Keyword }));
    const projectSymbols = Array.from(globalIndex.keys()).map(s => ({ label: s, kind: CompletionItemKind.Function }));
    const all = [...keywords, ...projectSymbols];
    const seen = new Set();
    return all.filter(item => {
        if (seen.has(item.label)) return false;
        seen.add(item.label);
        return true;
    });
});

connection.onCompletionResolve((item) => item);

connection.languages.semanticTokens.on((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return { data: [] };
    const tree = parser.parse(document.getText());
    const tokens = [];
    const tokenTypeMap = { 'comment': 0, 'string': 1, 'keyword': 2, 'number': 3, 'operator': 4, 'variable': 5, 'function.call': 6, 'function.definition': 6, 'boolean': 9, 'symbol': 5, 'punctuation.bracket': 10, 'parameter': 11, 'constant': 12 };
    if (highlightQuery) {
        const captures = highlightQuery.captures(tree.rootNode);
        captures.sort((a, b) => (a.node.startPosition.row - b.node.startPosition.row) || (a.node.startPosition.column - b.node.startPosition.column) || (a.index - b.index));
        let prevLine = 0, prevChar = 0;
        for (const capture of captures) {
            const typeIndex = tokenTypeMap[capture.name];
            if (typeIndex !== undefined) {
                const node = capture.node;
                const line = node.startPosition.row, char = node.startPosition.column, length = node.endPosition.column - node.startPosition.column;
                if (length <= 0) continue;
                const deltaLine = line - prevLine, deltaChar = deltaLine === 0 ? char - prevChar : char;
                if (deltaLine < 0 || (deltaLine === 0 && deltaChar < 0)) continue;
                tokens.push(deltaLine, deltaChar, length, typeIndex, 0);
                prevLine = line; prevChar = char;
            }
        }
    }
    return { data: tokens };
});

connection.onInitialized(() => {
    if (hasWorkspaceFolderCapability) {
        connection.workspace.onDidChangeWorkspaceFolders((params) => {
            for (const folder of params.event.added) {
                workspaceFolders.push(folder);
                setTimeout(() => scanWorkspace([folder]), 0);
            }
            for (const folder of params.event.removed) {
                workspaceFolders = workspaceFolders.filter(f => f.uri !== folder.uri);
            }
        });
    }
});

documents.onDidChangeContent((change) => {
    const oldContent = parseCache.get(change.document.uri)?.content || null;
    indexFile(change.document.uri, change.document.getText());
    // Update cache with incremental parsing support
    getOrParseFile(change.document.uri, change.document.getText(), oldContent);
    validateTextDocument(change.document);
});

// Invalidate cache when documents are closed
documents.onDidClose((event) => {
    parseCache.delete(event.document.uri);
});

async function validateTextDocument(textDocument) {
    const tree = parser.parse(textDocument.getText());
    const diagnostics = [];
    function findErrors(node) {
        if (node.type === 'ERROR' || node.isMissing) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: { start: { line: node.startPosition.row, character: node.startPosition.column }, end: { line: node.endPosition.row, character: node.endPosition.column } },
                message: node.type === 'ERROR' ? 'Syntax error' : `Missing node: ${node.type}`,
                source: 'metta-lsp',
            });
        }
        for (let i = 0; i < node.childCount; i++) findErrors(node.child(i));
    }
    findErrors(tree.rootNode);
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

documents.listen(connection);
connection.listen();
