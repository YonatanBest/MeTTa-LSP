const { URL } = require('url');
const keywords = require('./keywords.json');

const BUILTIN_SYMBOLS = new Set(keywords);

function normalizeUri(uri) {
    try {
        const parsed = new URL(uri);
        if (parsed.protocol === 'file:') {
            return parsed.href.toLowerCase();
        }
        return uri;
    } catch (e) {
        return uri;
    }
}

function uriToPath(uri) {
    try {
        const url = new URL(uri);
        if (url.protocol === 'file:') {
            let pathname = decodeURIComponent(url.pathname);
            if (process.platform === 'win32' && pathname.match(/^\/[a-zA-Z]:/)) {
                pathname = pathname.slice(1);
            }
            return pathname;
        }
    } catch (e) { }
    return null;
}

function isRangeEqual(range1, range2) {
    return range1.start.line === range2.start.line &&
        range1.start.character === range2.start.character &&
        range1.end.line === range2.end.line &&
        range1.end.character === range2.end.character;
}

module.exports = {
    BUILTIN_SYMBOLS,
    normalizeUri,
    uriToPath,
    isRangeEqual
};
