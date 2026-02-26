const { BUILTIN_DOCS } = require('../utils');

function handleHover(params, documents, analyzer) {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;

    const offset = document.offsetAt(params.position);

    const cached = analyzer.parseCache.get(params.textDocument.uri);
    const tree = cached?.tree || analyzer.parser.parse(document.getText());

    const nodeAtCursor = tree.rootNode.descendantForIndex(offset);
    if (!nodeAtCursor) return null;

    let symbolName = null;
    if (nodeAtCursor.type === 'symbol' || nodeAtCursor.type === 'variable') {
        symbolName = nodeAtCursor.text;
    } else if (nodeAtCursor.type === 'atom') {
        symbolName = nodeAtCursor.text;
    }
    if (!symbolName) return null;

    if (BUILTIN_DOCS.has(symbolName)) {
        return {
            contents: {
                kind: 'markdown',
                value: `**${symbolName}** *(built-in)*\n\n---\n\n${BUILTIN_DOCS.get(symbolName)}`
            }
        };
    }

    const entries = analyzer.globalIndex.get(symbolName);
    if (!entries || entries.length === 0) return null;

    const typeEntry = entries.find(e => e.op === ':');
    const defEntry = entries.find(e => e.op === '=')
        || entries.find(e => e.op !== ':')
        || entries[0];

    const paramNames = defEntry?.parameters || [];
    const typeSig = typeEntry?.typeSignature || null;
    const description = defEntry?.description || typeEntry?.description || null;

    let markdown = `**${symbolName}**\n\n`;

    if (typeSig) {
        markdown += `\`\`\`metta\n(: ${symbolName} ${typeSig})\n\`\`\`\n\n`;
    } else if (defEntry?.context) {
        markdown += `\`\`\`metta\n${defEntry.context}\n\`\`\`\n\n`;
    }

    if (description) {
        markdown += `**Description**\n\n${description}\n\n`;
    }

    const typeParts = typeSig ? parseArrowType(typeSig) : [];

    const paramTypeList = typeParts.length > 1 ? typeParts.slice(0, -1) : [];
    const returnType = typeParts.length > 0 ? typeParts[typeParts.length - 1] : null;
    const paramCount = Math.max(paramNames.length, paramTypeList.length);

    if (paramCount > 0) {
        markdown += `**Parameters**\n\n`;
        markdown += `| Name | Type |\n|------|------|\n`;
        for (let i = 0; i < paramCount; i++) {
            const pName = paramNames[i] || `$arg${i + 1}`;
            const pType = paramTypeList[i] || 'Any';
            markdown += `| ${pName} | ${pType} |\n`;
        }
        markdown += '\n';
    }

    if (returnType) {
        markdown += `**Returns** \`${returnType}\`\n\n`;
    }

    const defCount = entries.filter(e => e.op === '=' && e.uri === (typeEntry || defEntry)?.uri).length;
    if (defCount > 1) {
        markdown += `*${defCount} pattern definitions*\n\n`;
    }

    return {
        contents: {
            kind: 'markdown',
            value: markdown.trim()
        }
    };
}

function parseArrowType(typeSig) {
    if (!typeSig) return [];

    let inner = typeSig.trim();
    if (inner.startsWith('(') && inner.endsWith(')')) {
        inner = inner.slice(1, -1).trim();
    }
    if (!inner.startsWith('->')) return [typeSig];

    inner = inner.slice(2).trim();

    const parts = [];
    let current = '';
    let depth = 0;

    for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        if (ch === '(') { depth++; current += ch; }
        else if (ch === ')') { depth--; current += ch; }
        else if (ch === ' ' && depth === 0) {
            if (current.trim()) parts.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    if (current.trim()) parts.push(current.trim());

    return parts;
}

module.exports = { handleHover };