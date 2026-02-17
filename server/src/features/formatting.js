function formatMettaText(text) {
    const lines = text.split('\n');
    const formattedLines = [];
    let indentLevel = 0;
    const indentSize = 4;

    for (let line of lines) {
        const trimmed = line.trim();
        if (trimmed === '') {
            formattedLines.push('');
            continue;
        }
        formattedLines.push(' '.repeat(indentLevel * indentSize) + trimmed);
        for (const ch of trimmed) {
            if (ch === '(' || ch === '[') indentLevel++;
            else if (ch === ')' || ch === ']') indentLevel = Math.max(indentLevel - 1, 0);
        }
    }

    return formattedLines.join('\n');
}

function handleDocumentFormatting(params, documents) {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];

    const text = doc.getText();
    const formatted = formatMettaText(text);

    return [
        {
            range: {
                start: { line: 0, character: 0 },
                end: { line: doc.lineCount, character: 0 }
            },
            newText: formatted
        }
    ];
}

function handleDocumentRangeFormatting(params, documents) {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    const startOffset = document.offsetAt(params.range.start);
    const endOffset = document.offsetAt(params.range.end);
    const selectedText = document.getText().slice(startOffset, endOffset);
    return [{ range: params.range, newText: formatMettaText(selectedText) }];
}

function handleDocumentOnTypeFormatting(params, documents) {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    if (!['\n', ')', ']'].includes(params.ch)) return [];

    let startLine = params.position.line;
    while (startLine > 0) {
        const line = document.getText({ start: { line: startLine, character: 0 }, end: { line: startLine, character: Number.MAX_SAFE_INTEGER } });
        if (!line.trim().startsWith(')') && !line.trim().startsWith(']')) break;
        startLine--;
    }

    const endLine = params.position.line;
    const textToFormat = document.getText({
        start: { line: startLine, character: 0 },
        end: { line: endLine, character: Number.MAX_SAFE_INTEGER }
    });

    return [{
        range: { start: { line: startLine, character: 0 }, end: { line: endLine, character: Number.MAX_SAFE_INTEGER } },
        newText: formatMettaText(textToFormat)
    }];
}

module.exports = {
    formatMettaText,
    handleDocumentFormatting,
    handleDocumentRangeFormatting,
    handleDocumentOnTypeFormatting
};
