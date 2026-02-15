const path = require('path');
const { workspace } = require('vscode');
const { LanguageClient, TransportKind } = require('vscode-languageclient/node');

let client;

function activate(context) {

    const serverModule = context.asAbsolutePath(
        path.join('server', 'src', 'server.js')
    );


    const serverOptions = {
        run: { module: serverModule, transport: TransportKind.stdio },
        debug: {
            module: serverModule,
            transport: TransportKind.stdio,
        }
    };

    // Options to control the language client
    const clientOptions = {
        // Register the server for metta documents
        documentSelector: [{ scheme: 'file', language: 'metta' }],
        synchronize: {
            // Notify the server about file changes to '.metta' files contained in the workspace
            fileEvents: workspace.createFileSystemWatcher('**/*.metta')
        }
    };

    // Create the language client and start the client.
    client = new LanguageClient(
        'mettaLanguageServer',
        'MeTTa Language Server',
        serverOptions,
        clientOptions
    );

    // Start the client. This will also launch the server
    client.start();
}

function deactivate() {
    if (!client) {
        return undefined;
    }
    return client.stop();
}

module.exports = {
    activate,
    deactivate
};