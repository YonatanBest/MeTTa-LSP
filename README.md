# MeTTa Language Support (VS Code Extension)

This repository contains the official VS Code language support for MeTTa (Meta-Type-Talk).

## Structure

- **`client/`**: The VS Code extension logic (LSP Client).
- **`server/`**: The standalone Language Server (LSP Server).
- **`grammar/`**: The MeTTa Tree-sitter grammar source.
  - `src/grammar.json`: Generated machine-readable grammar definition.
  - `src/node-types.json`: AST structure description used by the LSP for indexing.
  - *Note: These files are auto-generated from `grammar.js` and should not be edited manually.*

### Modifying the Grammar
If you make changes to `grammar/grammar.js`, you must regenerate the parser and its support files:
```bash
npm run generate -w grammar
```
This will update `src/parser.c`, `src/grammar.json`, and `src/node-types.json`.

## Features

- [x] **Syntax Highlighting**: Advanced coloring for keywords, functions, parameters, and more.
- [x] **Diagnostics**: Real-time syntax error reporting.
- [x] **Go to Definition**: Jump to function or type definitions across the whole project.
- [x] **Hover Info**: View type signatures and definitions by hovering over symbols.
- [x] **Document Symbols**: Navigate files easily with the "Outline" view.
- [x] **Auto-Completion**: Context-aware suggestions for keywords and project symbols.
- [x] **Find All References**: Project-wide symbol references.
- [x] **Rename Symbol**: Safe workspace-wide symbol renaming.
- [x] **Workspace Symbol Indexing**: Global symbol tracking across files.


## Installation & Setup

1. **Install Dependencies**:
   This project uses **npm workspaces**. You only need to run the install command once in the root directory:
   ```bash
   npm install
   ```
   This will automatically install and link all components (`client`, `server`, and `grammar`).

2. **Development & Testing**:
   - Open the **root** project folder in VS Code.
   - Press **`F5`** to launch the "Extension Development Host".
   - Open any `.metta` file in the new window to see the features in action.

3. **Permanent Installation**:
   To install the extension permanently in your local VS Code:
   ```powershell
   # Windows (PowerShell)
   xcopy /E /I "client" "%USERPROFILE%\.vscode\extensions\metta-extension"
   xcopy /E /I "server" "%USERPROFILE%\.vscode\extensions\metta-extension\server"
   ```

## Requirements
- **Node.js**: v20 or newer (Recommended for best compatibility).
- **C++ Build Tools**: Required for compiling the Tree-sitter grammar (e.g., Visual Studio Build Tools on Windows).
