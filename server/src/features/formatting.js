const INDENT = 4;
const MAX_LINE = 80;

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// Tree Retrieval
// ─────────────────────────────────────────────────────────────

function getCachedTree(uri, text, analyzer) {
    if (!analyzer || !analyzer.getOrParseFile) return null;
    try {
        const cached = analyzer.getOrParseFile(uri, text);
        return cached?.tree || null;
    } catch {
        return null;
    }
}

// ─────────────────────────────────────────────────────────────
// Core Formatter
// ─────────────────────────────────────────────────────────────

function formatTree(tree, originalText) {
    const root = tree.rootNode;
    const children = root.children;
    const output = [];

    // We walk children and track blank lines that existed in the
    // original source so we can preserve them between top-level forms.
    // Comments stay attached to the form immediately below them.

    let i = 0;
    while (i < children.length) {
        const node = children[i];

        // Collect a run of comments that precede a non-comment node
        if (node.type === 'comment') {
            // Check if there was a blank line BEFORE this comment in the
            // original source — if so, preserve it
            if (output.length > 0) {
                const blanksBefore = countBlankLinesBefore(node, originalText);
                if (blanksBefore > 0) output.push('\n');
            }

            output.push(node.text);
            output.push('\n');
            i++;
            continue;
        }

        // For non-comment nodes, preserve a blank line if there was one
        // in the original source (but not after comments — comments stay
        // attached to the form below them)
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

    // Ensure single trailing newline
    while (output.length > 1 && output[output.length - 1] === '\n' && output[output.length - 2] === '\n') {
        output.pop();
    }
    if (!output.length || output[output.length - 1] !== '\n') {
        output.push('\n');
    }

    return output.join('');
}

// Count how many blank lines appear before a node in the original source
function countBlankLinesBefore(node, src) {
    const startByte = node.startIndex;
    // Walk backwards from the node's start to find preceding newlines
    let i = startByte - 1;
    let newlines = 0;

    // Skip the immediate newline that ends the previous line
    while (i >= 0 && (src[i] === ' ' || src[i] === '\t' || src[i] === '\r')) i--;
    if (i >= 0 && src[i] === '\n') {
        i--;
        // Now count additional newlines (blank lines)
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

// ─────────────────────────────────────────────────────────────
// Node Formatting
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// List Formatting
// ─────────────────────────────────────────────────────────────

// Special forms where first N args stay inline with the head
const INLINE_ARG_COUNT = new Map([
    ['=', 1],   // (= <pattern> \n    <body>)
    [':', 1],   // (: <name> \n    <type>)
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

    // Try flat first
    const flat = tryFlatFormat(node, indent);
    if (flat !== null) {
        output.push(flat);
        return;
    }

    const head = children[0];
    const args = children.slice(1);
    const argIndent = indent + INDENT;

    output.push('(');

    // Head ALWAYS stays on the same line as opening paren
    const headFlat = flattenNode(head);
    output.push(headFlat !== null ? headFlat : head.text);

    if (args.length === 0) {
        output.push(')');
        return;
    }

    // Check if head is a special form with inline args
    // Check if head is a special form with inline args
    // head.text on an atom gives us the symbol text directly
    const headText = headFlat || head.text || '';
    const inlineCount = INLINE_ARG_COUNT.get(headText) ?? 0;

    // Args that stay inline with the head on the same line
    const inlineArgs = args.slice(0, inlineCount);
    // Args that go on new lines
    const breakArgs = args.slice(inlineCount);

    // Emit inline args on the same line
    for (const arg of inlineArgs) {
        output.push(' ');
        const argFlat = flattenNode(arg);
        if (argFlat !== null) {
            output.push(argFlat);
        } else {
            formatNode(arg, argIndent, output);
        }
    }

    // Emit break args each on their own indented line
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

    // Force multiline if any argument is a list containing list arguments
    // (deep nesting) — BUT only if we are at the top level of the form,
    // not when we are already inside a special inline-arg form
    const args = children.slice(1);
    const hasDeepNesting = args.some(arg => {
        if (arg.type !== 'list') return false;
        const argChildren = arg.children.filter(
            c => c.type !== '(' && c.type !== ')'
        );
        // If this arg-list itself has list arguments, it's deep
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

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

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