function handleHover(params, documents, analyzer) {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    const offset = document.offsetAt(params.position);
    const tree = analyzer.parser.parse(document.getText());
    const nodeAtCursor = tree.rootNode.descendantForIndex(offset);
    if (!nodeAtCursor || (nodeAtCursor.type !== 'symbol' && nodeAtCursor.type !== 'variable')) return null;
    const symbolName = nodeAtCursor.text;
    const entries = analyzer.globalIndex.get(symbolName);
    if (entries) {
        const bestMatch = entries.find(s => s.op === ':' && s.uri === params.textDocument.uri)
            || entries.find(s => s.op === ':')
            || entries.find(s => s.uri === params.textDocument.uri)
            || entries[0];
        return { contents: { kind: 'markdown', value: `\`\`\`metta\n${bestMatch.context}\n\`\`\`` } };
    }
    return null;
}

module.exports = {
    handleHover
};
