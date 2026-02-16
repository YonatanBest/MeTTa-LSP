# MeTTa Language Support (VS Code Extension)

Full-featured Language Server Protocol (LSP) support for the [MeTTa](https://wiki.opencog.org/w/MeTTa) language in Visual Studio Code.

## Features

- **Syntax Highlighting** — Tree-sitter powered coloring for keywords, functions, variables, strings, numbers, and operators
- **Diagnostics** — Real-time syntax error reporting as you type
- **Go to Definition** — Jump to any function or type definition across the workspace
- **Hover Info** — View type signatures and definitions by hovering over symbols
- **Auto-Completion** — Context-aware suggestions for keywords and project symbols
- **Find All References** — Locate every usage of a symbol across the project
- **Rename Symbol** — Safe workspace-wide renaming with conflict detection
- **Document Symbols** — Navigate files via the Outline view
- **Signature Help** — Parameter hints when calling functions
- **Formatting** — Document and range formatting for MeTTa code

## Installation

### From VSIX (recommended for testing)

1. Download or build the `.vsix` file (see [Building](#building) below)
2. Open VS Code → Extensions (`Ctrl+Shift+X`) → `⋯` menu → **Install from VSIX...**
3. Select the `.vsix` file — done!

### From Source (development)

```powershell
git clone https://github.com/iCog-Labs-Dev/MeTTa-LSP.git
cd MeTTa-LSP
npm install
```

Press **F5** in VS Code to launch the Extension Development Host.

## Building

### Prerequisites

- **Node.js** v20+
- **C++ Build Tools** — Required for compiling the Tree-sitter native grammar (e.g., Visual Studio Build Tools on Windows)

### Build & Package

```powershell
npm install          # install all dependencies
npm run build        # bundle client + server
npm run package      # build + create .vsix
```

The `.vsix` file will appear in the project root (e.g., `vscode-metta-1.0.0.vsix`).

## Project Structure

```
├── client/          # VS Code extension client (LSP client)
│   └── src/
│       └── extension.js
├── server/          # Language Server (LSP server)
│   └── src/
│       └── server.js
├── grammar/         # Tree-sitter MeTTa grammar
│   ├── grammar.js
│   ├── src/         # Generated parser (parser.c, grammar.json)
│   ├── queries/     # Syntax highlighting queries
│   └── bindings/
│       └── node/    # Node.js native binding
└── dist/            # Bundled output (generated)
```

## License

[MIT](LICENSE)
