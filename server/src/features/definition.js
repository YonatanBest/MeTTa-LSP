function handleDefinition(params, documents, analyzer) {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    const offset = document.offsetAt(params.position);
    const tree = analyzer.parser.parse(document.getText());
    const nodeAtCursor = tree.rootNode.descendantForIndex(offset);
    if (!nodeAtCursor || (nodeAtCursor.type !== 'symbol' && nodeAtCursor.type !== 'variable')) return null;
    const symbolName = nodeAtCursor.text;
    const entries = analyzer.globalIndex.get(symbolName);
    if (entries) {
        return entries.map(s => ({ uri: s.uri, range: s.range }));
    }
    return null;
}

module.exports = {
    handleDefinition
};
