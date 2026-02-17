const { CompletionItemKind } = require('vscode-languageserver/node');
const { BUILTIN_SYMBOLS } = require('../utils');

function handleCompletion(params, analyzer) {
    const keywords = Array.from(BUILTIN_SYMBOLS)
        .map(k => ({ label: k, kind: CompletionItemKind.Keyword }));

    const projectSymbols = Array.from(analyzer.globalIndex.keys()).map(s => ({ label: s, kind: CompletionItemKind.Function }));
    const all = [...keywords, ...projectSymbols];
    const seen = new Set();
    return all.filter(item => {
        if (seen.has(item.label)) return false;
        seen.add(item.label);
        return true;
    });
}

function handleCompletionResolve(item) {
    return item;
}

module.exports = {
    handleCompletion,
    handleCompletionResolve
};
