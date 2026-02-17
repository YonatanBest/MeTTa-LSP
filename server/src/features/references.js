function handleReferences(params, documents, analyzer, workspaceFolders) {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    const offset = document.offsetAt(params.position);
    const tree = analyzer.parser.parse(document.getText());
    const nodeAtCursor = tree.rootNode.descendantForIndex(offset);

    if (!nodeAtCursor || (nodeAtCursor.type !== 'symbol' && nodeAtCursor.type !== 'variable')) return [];

    const symbolName = nodeAtCursor.text;

    return analyzer.findAllReferences(
        symbolName,
        params.context?.includeDeclaration !== false,
        params.textDocument.uri,
        params.position,
        documents,
        workspaceFolders
    );
}

module.exports = {
    handleReferences
};
