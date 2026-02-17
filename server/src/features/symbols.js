function handleDocumentSymbols(params, documents, analyzer) {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    const tree = analyzer.parser.parse(document.getText());
    const matches = analyzer.symbolQuery.matches(tree.rootNode);
    const symbols = [];
    const seen = new Set();

    for (const match of matches) {
        const nameNode = match.captures.find(c => c.name === 'name')?.node;
        const opNode = match.captures.find(c => c.name === 'op')?.node;
        if (nameNode) {
            const key = `${nameNode.startPosition.row}:${nameNode.startPosition.column}`;
            if (!seen.has(key)) {
                seen.add(key);
                let parent = nameNode.parent;
                while (parent && parent.type !== 'list') parent = parent.parent;
                const context = parent ? parent.text : nameNode.text;
                const kind = analyzer.detectSymbolKind(nameNode, opNode || { text: '=' }, context);

                symbols.push({
                    name: nameNode.text,
                    kind: kind,
                    location: {
                        uri: params.textDocument.uri,
                        range: {
                            start: { line: nameNode.startPosition.row, character: nameNode.startPosition.column },
                            end: { line: nameNode.endPosition.row, character: nameNode.endPosition.column }
                        }
                    }
                });
            }
        }
    }

    return symbols;
}

module.exports = {
    handleDocumentSymbols
};
