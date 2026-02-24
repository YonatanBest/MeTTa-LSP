const { DiagnosticSeverity } = require('vscode-languageserver/node');

function validateTextDocument(document, analyzer) {
    const text = document.getText();
    const tree = analyzer.parser.parse(text);
    const diagnostics = [];

    traverseTree(tree.rootNode, (node) => {
        if (node.isMissing) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: { line: node.startPosition.row, character: node.startPosition.column },
                    end: { line: node.endPosition.row, character: node.endPosition.column }
                },
                message: `Syntax error: missing ${node.type}`,
                source: 'metta-lsp'
            });
        } else if (node.type === 'ERROR') {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: { line: node.startPosition.row, character: node.startPosition.column },
                    end: { line: node.endPosition.row, character: node.endPosition.column }
                },
                message: "Syntax error",
                source: 'metta-lsp'
            });
        }
    });

    const definitionsByName = new Map();
    const matches = analyzer.symbolQuery.matches(tree.rootNode);

    for (const match of matches) {
        const nameNode = match.captures.find(c => c.name === 'name')?.node;
        const opNode = match.captures.find(c => c.name === 'op')?.node;

        if (nameNode && opNode && opNode.text === '=') {
            let innerList = nameNode.parent;
            while (innerList && innerList.type !== 'list') innerList = innerList.parent;

            let definitionNode = innerList;
            let outer = innerList.parent;
            while (outer && outer.type !== 'list') outer = outer.parent;
            if (outer) {
                definitionNode = outer;

                const namedArgs = definitionNode.children.filter(c => c.type === 'atom' || c.type === 'list');
                if (namedArgs.indexOf(innerList) !== 1) continue;

                const isTopLevel = definitionNode.parent && definitionNode.parent.type === 'source_file';
                if (!isTopLevel) continue;
            } else {
                continue;
            }

            const name = nameNode.text;
            if (!definitionsByName.has(name)) {
                definitionsByName.set(name, []);
            }
            definitionsByName.get(name).push(nameNode);
        }
    }

    for (const [name, nodes] of definitionsByName) {
        if (nodes.length > 1) {
            for (const nameNode of nodes) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: {
                        start: { line: nameNode.startPosition.row, character: nameNode.startPosition.column },
                        end: { line: nameNode.endPosition.row, character: nameNode.endPosition.column }
                    },
                    message: `Duplicate definition of '${name}' (${nodes.length} definitions in this file)`,
                    source: 'metta-lsp'
                });
            }
        }
    }

    const { BUILTIN_SYMBOLS } = require('../utils');
    const validOperators = new Set(['=', ':', '->', 'macro', 'defmacro', '==', '~=', '+', '-', '*', '/', '>', '<', '>=', '<=']);

    traverseTree(tree.rootNode, (node) => {
        if (node.type === 'list') {
            const namedChildren = node.children.filter(c => c.type === 'atom' || c.type === 'list');
            if (namedChildren.length > 0) {
                const head = namedChildren[0];
                if (head.type === 'atom') {
                    const symbolNode = head.children.find(c => c.type === 'symbol');
                    if (symbolNode) {
                        const name = symbolNode.text;

                        if (BUILTIN_SYMBOLS.has(name)) return;

                        if (validOperators.has(name)) return;

                        if (name.startsWith('$')) return;

                        let p = node.parent;
                        if (p && p.type === 'list') {
                            const pNamed = p.children.filter(c => c.type === 'atom' || c.type === 'list');
                            if (pNamed.length > 0 && pNamed[0].text === '=') {
                                if (pNamed[1] === node) return;
                            }
                        }

                        let gp = node.parent;
                        if (gp && gp.type === 'list') {
                            const gpNamed = gp.children.filter(c => c.type === 'atom' || c.type === 'list');
                            if (gpNamed.length > 0 && gpNamed[0].text === ':') {
                                if (gpNamed[1] === head) return;
                            }
                        }

                        const definitions = analyzer.globalIndex.get(name);
                        if (!definitions || definitions.length === 0) {
                            diagnostics.push({
                                severity: DiagnosticSeverity.Error,
                                range: {
                                    start: { line: symbolNode.startPosition.row, character: symbolNode.startPosition.column },
                                    end: { line: symbolNode.endPosition.row, character: symbolNode.endPosition.column }
                                },
                                message: `Undefined function '${name}'`,
                                source: 'metta-lsp'
                            });
                        }
                    }
                }
            }
        }
    });

    return diagnostics;
}

function traverseTree(node, callback) {
    callback(node);
    for (let i = 0; i < node.childCount; i++) {
        traverseTree(node.child(i), callback);
    }
}

module.exports = {
    validateTextDocument
};
