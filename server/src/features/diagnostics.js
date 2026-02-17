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
