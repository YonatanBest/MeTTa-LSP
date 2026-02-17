const path = require('path');
const fs = require('fs');
const Parser = require('tree-sitter');
const Metta = require('../../../grammar');

const queriesPath = path.resolve(__dirname, '../../../grammar/queries/metta/highlights.scm');
let highlightQuery;

try {
    if (fs.existsSync(queriesPath)) {
        const queryContent = fs.readFileSync(queriesPath, 'utf8');
        highlightQuery = new Parser.Query(Metta, queryContent);
    }
} catch (e) {
    console.error(`Failed to load highlights.scm from ${queriesPath}`, e);
}

const tokenTypeMap = {
    'comment': 0, 'string': 1, 'keyword': 2, 'number': 3, 'operator': 4,
    'variable': 5, 'function.call': 6, 'function.definition': 6,
    'boolean': 9, 'symbol': 5, 'punctuation.bracket': 10,
    'parameter': 11, 'constant': 12
};

function handleSemanticTokens(params, documents, analyzer) {
    const document = documents.get(params.textDocument.uri);
    if (!document) return { data: [] };

    const tree = analyzer.parser.parse(document.getText());
    const tokens = [];

    if (highlightQuery) {
        const captures = highlightQuery.captures(tree.rootNode);
        captures.sort((a, b) => (a.node.startPosition.row - b.node.startPosition.row) || (a.node.startPosition.column - b.node.startPosition.column) || (a.index - b.index));

        let prevLine = 0, prevChar = 0;
        for (const capture of captures) {
            const typeIndex = tokenTypeMap[capture.name];
            if (typeIndex !== undefined) {
                const node = capture.node;
                const line = node.startPosition.row, char = node.startPosition.column, length = node.endPosition.column - node.startPosition.column;
                if (length <= 0) continue;
                const deltaLine = line - prevLine, deltaChar = deltaLine === 0 ? char - prevChar : char;
                if (deltaLine < 0 || (deltaLine === 0 && deltaChar < 0)) continue;
                tokens.push(deltaLine, deltaChar, length, typeIndex, 0);
                prevLine = line; prevChar = char;
            }
        }
    }
    return { data: tokens };
}

module.exports = {
    handleSemanticTokens
};
