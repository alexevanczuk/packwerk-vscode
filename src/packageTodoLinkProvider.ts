import * as vscode from 'vscode';
import * as path from 'path';
import { ConstantDefinitionCache } from './constantDefinitionCache';

export class PackageTodoLinkProvider implements vscode.DocumentLinkProvider {
  private constantCache: ConstantDefinitionCache;

  constructor(constantCache: ConstantDefinitionCache) {
    this.constantCache = constantCache;
  }

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

    let inFiles = false;

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];

      // Match pack name at start of line: "packs/foo:", "gems/bar:", or "."
      const packMatch = line.match(/^([a-zA-Z0-9_\-./]+):$/);
      if (packMatch) {
        const packName = packMatch[1];
        if (packName !== '.' && packName.includes('/')) {
          const packageYmlPath = path.join(workspaceRoot, packName, 'package.yml');
          const range = new vscode.Range(
            new vscode.Position(lineNum, 0),
            new vscode.Position(lineNum, packName.length)
          );
          const link = new vscode.DocumentLink(
            range,
            vscode.Uri.file(packageYmlPath)
          );
          links.push(link);
        }
        inFiles = false;
        continue;
      }

      // Match constant name: '  "::ConstantName":'
      const constantMatch = line.match(/^(\s*)"(::[\w:]+)":\s*$/);
      if (constantMatch) {
        const prefix = constantMatch[1];
        const constantName = constantMatch[2];
        const definitionPath = this.constantCache.getDefinitionPath(constantName);

        if (definitionPath) {
          const fullPath = path.join(workspaceRoot, definitionPath);
          // +1 for the opening quote
          const startChar = prefix.length + 1;
          const endChar = startChar + constantName.length;

          const range = new vscode.Range(
            new vscode.Position(lineNum, startChar),
            new vscode.Position(lineNum, endChar)
          );

          const link = new vscode.DocumentLink(
            range,
            vscode.Uri.file(fullPath)
          );
          links.push(link);
        }
        continue;
      }

      // Check if we're entering a files section
      if (/^\s*files:\s*$/.test(line)) {
        inFiles = true;
        continue;
      }

      // If we hit a line that's not a list item and not empty, we've left the files section
      if (inFiles && line.trim() !== '' && !/^\s*-\s/.test(line)) {
        inFiles = false;
      }

      if (inFiles) {
        // Match "    - path/to/file.rb" style entries
        const match = line.match(/^(\s*-\s*)(.+\.rb)\s*$/);
        if (match) {
          const prefix = match[1];
          const filePath = match[2];

          const fullPath = path.join(workspaceRoot, filePath);
          const startChar = prefix.length;
          const endChar = startChar + filePath.length;

          const range = new vscode.Range(
            new vscode.Position(lineNum, startChar),
            new vscode.Position(lineNum, endChar)
          );

          const link = new vscode.DocumentLink(
            range,
            vscode.Uri.file(fullPath)
          );
          links.push(link);
        }
      }
    }

    return links;
  }
}
