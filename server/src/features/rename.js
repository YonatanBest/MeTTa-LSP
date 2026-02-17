const { ResponseError, ErrorCodes } = require('vscode-languageserver/node');
const { BUILTIN_SYMBOLS, normalizeUri, isRangeEqual } = require('../utils');

function validateRename(symbolName, newName, analyzer) {
    if (BUILTIN_SYMBOLS.has(symbolName)) {
        return {
            valid: false,
            message: `Cannot rename built-in symbol: ${symbolName}`
        };
    }

    if (BUILTIN_SYMBOLS.has(newName)) {
        return {
            valid: false,
            message: `Cannot rename to built-in symbol: ${newName}`
        };
    }

    const existingDefs = analyzer.globalIndex.get(newName);
    if (existingDefs && existingDefs.length > 0) {
        const currentDefs = analyzer.globalIndex.get(symbolName);
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

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(newName) && !/^[=:->!&|]+$/.test(newName)) {
        return {
            valid: false,
            message: `Invalid symbol name: ${newName}`
        };
    }

    return { valid: true };
}

function handleRenameRequest(params, documents, analyzer, workspaceFolders) {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    const offset = document.offsetAt(params.position);
    const tree = analyzer.parser.parse(document.getText());
    const nodeAtCursor = tree.rootNode.descendantForIndex(offset);
    if (!nodeAtCursor || (nodeAtCursor.type !== 'symbol' && nodeAtCursor.type !== 'variable')) return null;
    const symbolName = nodeAtCursor.text;
    const newName = params.newName;

    if (symbolName === newName) {
        return null;
    }

    const validation = validateRename(symbolName, newName, analyzer);
    if (!validation.valid) {
        throw new ResponseError(ErrorCodes.InvalidRequest, validation.message);
    }

    const references = analyzer.findAllReferences(symbolName, true, params.textDocument.uri, params.position, documents, workspaceFolders);

    if (references.length === 0) {
        return null;
    }

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
}

function handlePrepareRename(params, documents, analyzer, workspaceFolders) {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    const offset = document.offsetAt(params.position);
    const tree = analyzer.parser.parse(document.getText());
    const nodeAtCursor = tree.rootNode.descendantForIndex(offset);
    if (!nodeAtCursor || (nodeAtCursor.type !== 'symbol' && nodeAtCursor.type !== 'variable')) return null;

    const symbolName = nodeAtCursor.text;

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

    const references = analyzer.findAllReferences(symbolName, true, params.textDocument.uri, params.position, documents, workspaceFolders);
    const placeholder = `${symbolName} (${references.length} reference${references.length !== 1 ? 's' : ''})`;

    return { range, placeholder };
}

module.exports = {
    handleRenameRequest,
    handlePrepareRename
};
