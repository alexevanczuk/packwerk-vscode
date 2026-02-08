import * as vscode from 'vscode';
import * as path from 'path';

export class PackageYmlLinkProvider implements vscode.DocumentLinkProvider {
  provideDocumentLinks(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.DocumentLink[] {
    const links: vscode.DocumentLink[] = [];
    const workspaceRoot = vscode.workspace.rootPath;

    if (!workspaceRoot) {
      return links;
    }

    const text = document.getText();
    const lines = text.split('\n');

    let inDependencies = false;

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];

      // Check if we're entering or leaving dependencies section
      if (/^dependencies:/.test(line)) {
        inDependencies = true;
        continue;
      }

      // If line doesn't start with whitespace or dash, we've left the dependencies section
      if (inDependencies && /^[^\s-]/.test(line)) {
        inDependencies = false;
      }

      if (inDependencies) {
        // Match "  - packs/foo" or "  - ." style entries
        const match = line.match(/^(\s*-\s*)["']?([^"'\s]+)["']?\s*$/);
        if (match) {
          const prefix = match[1];
          const packName = match[2];

          // Skip the root pack "."
          if (packName === '.') {
            continue;
          }

          const packageYmlPath = path.join(workspaceRoot, packName, 'package.yml');
          const startChar = prefix.length;
          const endChar = startChar + packName.length;

          const range = new vscode.Range(
            new vscode.Position(lineNum, startChar),
            new vscode.Position(lineNum, endChar)
          );

          const link = new vscode.DocumentLink(
            range,
            vscode.Uri.file(packageYmlPath)
          );
          links.push(link);
        }
      }
    }

    return links;
  }
}
