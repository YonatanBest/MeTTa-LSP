const path = require('path');
const { SymbolKind } = require('vscode-languageserver/node');

function handleSignatureHelp(params, documents, analyzer) {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    const offset = document.offsetAt(params.position);
    const tree = analyzer.parser.parse(document.getText());

    let node = tree.rootNode.descendantForIndex(offset);

    while (node && node.type !== 'list') {
        node = node.parent;
    }

    if (!node) return null;

    const headNode = node.childForFieldName('head');
    if (!headNode) return null;

    const headName = headNode.text;
    const entries = analyzer.globalIndex.get(headName);
    if (!entries) return null;

    const signatures = entries
        .filter(s => s.op === ':')
        .map(s => {
            const label = s.context;
            const parameters = [];

            const sigTree = analyzer.parser.parse(label);
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
}

module.exports = {
    handleSignatureHelp
};
