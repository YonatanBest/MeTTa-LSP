const INDENT = 4;
const MAX_LINE = 80;

function handleDocumentFormatting(params, documents, analyzer) {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];

    const text = doc.getText();
    const tree = getCachedTree(params.textDocument.uri, text, analyzer);
    if (!tree) return [];

    const formatted = formatTree(tree, text);
    return [{ range: fullRange(doc), newText: formatted }];
}

function handleDocumentRangeFormatting(params, documents, analyzer) {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];

    const text = doc.getText();
    const tree = getCachedTree(params.textDocument.uri, text, analyzer);
    if (!tree) return [];

    const formatted = formatTree(tree, text);
    return [{ range: fullRange(doc), newText: formatted }];
}

function handleDocumentOnTypeFormatting(params, documents, analyzer) {
    if (!['\n', ')', ']'].includes(params.ch)) return [];

    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];

    const text = doc.getText();
    const tree = getCachedTree(params.textDocument.uri, text, analyzer);
    if (!tree) return [];

    const formatted = formatTree(tree, text);
    return [{ range: fullRange(doc), newText: formatted }];
}

function getCachedTree(uri, text, analyzer) {
    if (!analyzer || !analyzer.getOrParseFile) return null;
    try {
        const cached = analyzer.getOrParseFile(uri, text);
        return cached?.tree || null;
    } catch {
        return null;
    }
}


function formatTree(tree, originalText) {
    const root = tree.rootNode;
    const children = root.children;
    const output = [];

    let i = 0;
    while (i < children.length) {
        const node = children[i];

        if (node.type === 'comment') {
            if (output.length > 0) {
                const blanksBefore = countBlankLinesBefore(node, originalText);
                if (blanksBefore > 0) output.push('\n');
            }

            output.push(node.text);
            output.push('\n');
            i++;
            continue;
        }

        if (output.length > 0) {
            const prev = children[i - 1];
            const prevWasComment = prev && prev.type === 'comment';

            if (!prevWasComment) {
                const blanksBefore = countBlankLinesBefore(node, originalText);
                if (blanksBefore > 0) output.push('\n');
            }
        }

        const nodeOutput = [];
        formatNode(node, 0, nodeOutput);
        output.push(nodeOutput.join(''));
        output.push('\n');
        i++;
    }

    while (output.length > 1 && output[output.length - 1] === '\n' && output[output.length - 2] === '\n') {
        output.pop();
    }
    if (!output.length || output[output.length - 1] !== '\n') {
        output.push('\n');
    }

    return output.join('');
}

function countBlankLinesBefore(node, src) {
    const startByte = node.startIndex;
    let i = startByte - 1;
    let newlines = 0;
    while (i >= 0 && (src[i] === ' ' || src[i] === '\t' || src[i] === '\r')) i--;
    if (i >= 0 && src[i] === '\n') {
        i--;
        while (i >= 0) {
            if (src[i] === '\n') {
                newlines++;
                i--;
            } else if (src[i] === ' ' || src[i] === '\t' || src[i] === '\r') {
                i--;
            } else {
                break;
            }
        }
    }

    return newlines;
}

function formatNode(node, indent, output) {
    switch (node.type) {
        case 'list':
            return formatList(node, indent, output);
        case 'comment':
            output.push(node.text);
            return;
        default:
            output.push(node.text);
            return;
    }
}

const INLINE_ARG_COUNT = new Map([
    ['=', 1],
    [':', 1],
    ['->', 0],
    ['let', 2],
    ['let*', 2],
    ['match', 2],
    ['case', 1],
    ['if', 1],
]);

function formatList(node, indent, output) {
    const children = node.children.filter(
        c => c.type !== '(' && c.type !== ')'
    );

    if (children.length === 0) {
        output.push('()');
        return;
    }

    const flat = tryFlatFormat(node, indent);
    if (flat !== null) {
        output.push(flat);
        return;
    }

    const head = children[0];
    const args = children.slice(1);
    const argIndent = indent + INDENT;

    output.push('(');

    const headFlat = flattenNode(head);
    output.push(headFlat !== null ? headFlat : head.text);

    if (args.length === 0) {
        output.push(')');
        return;
    }
    const headText = headFlat || head.text || '';
    const inlineCount = INLINE_ARG_COUNT.get(headText) ?? 0;

    const inlineArgs = args.slice(0, inlineCount);
    const breakArgs = args.slice(inlineCount);

    for (const arg of inlineArgs) {
        output.push(' ');
        const argFlat = flattenNode(arg);
        if (argFlat !== null) {
            output.push(argFlat);
        } else {
            formatNode(arg, argIndent, output);
        }
    }

    const argPrefix = '\n' + ' '.repeat(argIndent);
    for (const arg of breakArgs) {
        output.push(argPrefix);
        formatNode(arg, argIndent, output);
    }

    output.push(')');
}

function tryFlatFormat(node, indent) {
    const children = node.children.filter(
        c => c.type !== '(' && c.type !== ')'
    );

    const args = children.slice(1);
    const hasDeepNesting = args.some(arg => {
        if (arg.type !== 'list') return false;
        const argChildren = arg.children.filter(
            c => c.type !== '(' && c.type !== ')'
        );
        return argChildren.slice(1).some(c => c.type === 'list');
    });

    if (hasDeepNesting) return null;

    const text = flattenNode(node);
    if (text === null) return null;
    if (indent + text.length <= MAX_LINE) return text;
    return null;
}

function flattenNode(node) {
    if (node.type === 'comment') return null;

    if (
        node.type === 'atom' ||
        node.type === 'number' ||
        node.type === 'string' ||
        node.type === 'symbol' ||
        node.type === 'variable'
    ) {
        return node.text;
    }

    if (node.type === 'list') {
        const children = node.children.filter(
            c => c.type !== '(' && c.type !== ')'
        );
        if (children.length === 0) return '()';

        const parts = [];
        for (const child of children) {
            const flat = flattenNode(child);
            if (flat === null) return null;
            parts.push(flat);
        }
        return '(' + parts.join(' ') + ')';
    }

    return node.text;
}

function fullRange(doc) {
    return {
        start: { line: 0, character: 0 },
        end: { line: doc.lineCount - 1, character: Number.MAX_SAFE_INTEGER }
    };
}

module.exports = {
    handleDocumentFormatting,
    handleDocumentRangeFormatting,
    handleDocumentOnTypeFormatting
};