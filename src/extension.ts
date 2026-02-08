import * as vscode from 'vscode';
import { Packwerk } from './packwerk';
import { onDidChangeConfiguration } from './configuration';
import { PackwerkCodeActionProvider } from './codeActionProvider';
import { PackageYmlLinkProvider } from './packageYmlLinkProvider';
import { exec } from 'child_process';
import { findSigilInsertionLine } from './fileHeaderUtils';

// entry point of extension
export function activate(context: vscode.ExtensionContext): void {
  'use strict';

  const diag = vscode.languages.createDiagnosticCollection('ruby');
  context.subscriptions.push(diag);

  const outputChannel = vscode.window.createOutputChannel('Pks');
  context.subscriptions.push(outputChannel);

  const packwerk = new Packwerk(diag, outputChannel);
  const disposable = vscode.commands.registerCommand('ruby.pks', () => {
    const document = vscode.window.activeTextEditor.document;
    packwerk.execute(document);
  });

  context.subscriptions.push(disposable);

  // Register command to run pks check on all files
  context.subscriptions.push(
    vscode.commands.registerCommand('ruby.pks.all', () => {
      packwerk.executeAll();
    })
  );

  // Register command to go to package.yml for current file
  context.subscriptions.push(
    vscode.commands.registerCommand('ruby.pks.goToPackageYml', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return;
      }

      const cwd = vscode.workspace.rootPath;
      if (!cwd) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      const filePath = editor.document.fileName;
      const relativePath = filePath.replace(cwd + '/', '');
      const command = `pks for-file ${relativePath}`;

      exec(command, { cwd }, (error: Error | null, stdout: string, stderr: string) => {
        if (error) {
          vscode.window.showErrorMessage(`Could not find package.yml: ${stderr || error.message}`);
          return;
        }

        const packageYmlPath = stdout.trim();
        if (packageYmlPath) {
          const uri = vscode.Uri.file(packageYmlPath);
          vscode.window.showTextDocument(uri);
        }
      });
    })
  );

  // Register code action provider
  const codeActionProvider = new PackwerkCodeActionProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      ['ruby', 'gemfile'],
      codeActionProvider,
      {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
      }
    )
  );

  // Register document link provider for package.yml dependencies
  const packageYmlSelector: vscode.DocumentSelector = {
    scheme: 'file',
    pattern: '**/package.yml'
  };
  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider(
      packageYmlSelector,
      new PackageYmlLinkProvider()
    )
  );

  // Register command to make constant public
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'ruby.pks.makePublic',
      async (constantName: string | undefined) => {
        if (!constantName) {
          vscode.window.showErrorMessage('Could not extract constant name from violation');
          return;
        }

        const cwd = vscode.workspace.rootPath;
        if (!cwd) {
          vscode.window.showErrorMessage('No workspace folder open');
          return;
        }

        // Run pks list-definitions to find where the constant is defined
        const command = `pks list-definitions | grep "${constantName}"`;
        exec(command, { cwd }, async (error: Error | null, stdout: string, stderr: string) => {
          if (error) {
            vscode.window.showErrorMessage(`Could not find definition for ${constantName}: ${stderr || error.message}`);
            return;
          }

          // Parse output: "::Cryptography::AegisJwt::Encode" is defined at "packs/cryptography/app/domain/aegis_jwt/encode.rb"
          const match = stdout.match(/is defined at "([^"]+)"/);
          if (!match) {
            vscode.window.showErrorMessage(`Could not parse definition location for ${constantName}`);
            return;
          }

          const definitionFile = match[1];
          const fullPath = `${cwd}/${definitionFile}`;

          try {
            const uri = vscode.Uri.file(fullPath);
            const document = await vscode.workspace.openTextDocument(uri);

            // Get all lines as strings
            const lines: string[] = [];
            for (let i = 0; i < document.lineCount; i++) {
              lines.push(document.lineAt(i).text);
            }

            // Check if pack_public already exists
            const alreadyHasSigil = lines.some(line => line.trim() === '# pack_public: true');
            if (alreadyHasSigil) {
              vscode.window.showInformationMessage(`${constantName} already has # pack_public: true`);
              return;
            }

            // Find where to insert the sigil
            const insertLine = findSigilInsertionLine(lines);

            // Check if the line we're inserting at is blank - if so, we'll replace it
            const isBlankLine = insertLine < lines.length && lines[insertLine].trim() === '';

            const edit = new vscode.WorkspaceEdit();
            if (isBlankLine) {
              // Just replace the text on the blank line (not the newline itself)
              // This keeps the blank line as-is, just with new content
              const lineContent = document.lineAt(insertLine);
              const range = lineContent.range;
              edit.replace(uri, range, `# pack_public: true`);
            } else {
              // Insert before the code with blank line after
              const position = new vscode.Position(insertLine, 0);
              edit.insert(uri, position, `# pack_public: true\n\n`);
            }

            await vscode.workspace.applyEdit(edit);
            await document.save();

            vscode.window.showInformationMessage(`Added # pack_public: true to ${constantName}`);

            // Re-run packwerk check to update diagnostics
            packwerk.executeAll();
          } catch (err) {
            vscode.window.showErrorMessage(`Failed to open file ${definitionFile}: ${err}`);
          }
        });
      }
    )
  );

  // Register command to add dependency
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'ruby.pks.addDependency',
      async (sourcePack: string, targetPack: string) => {
        const cwd = vscode.workspace.rootPath;
        if (!cwd) {
          vscode.window.showErrorMessage('No workspace folder open');
          return;
        }

        const command = `pks add-dependency ${sourcePack} ${targetPack}`;
        exec(command, { cwd }, (error: Error | null, _stdout: string, stderr: string) => {
          if (error) {
            vscode.window.showErrorMessage(`Failed to add dependency: ${stderr || error.message}`);
            return;
          }
          vscode.window.showInformationMessage(`Added dependency from ${sourcePack} to ${targetPack}`);
          // Re-run packwerk check to update diagnostics
          packwerk.executeAll();
        });
      }
    )
  );

  // Register command: todo: this file -> CONSTANT
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'ruby.pks.todoFile',
      async (file: string, constantName: string) => {
        const cwd = vscode.workspace.rootPath;
        if (!cwd) {
          vscode.window.showErrorMessage('No workspace folder open');
          return;
        }

        const command = `pks update ${file} --constant ${constantName}`;
        exec(command, { cwd }, (error: Error | null, _stdout: string, stderr: string) => {
          if (error) {
            vscode.window.showErrorMessage(`Failed: ${stderr || error.message}`);
            return;
          }
          vscode.window.showInformationMessage(`Added ${constantName} to todo for ${file}`);
          packwerk.executeAll();
        });
      }
    )
  );

  // Register command: todo: pack -> CONSTANT
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'ruby.pks.todoPackConstant',
      async (file: string, constantName: string) => {
        const cwd = vscode.workspace.rootPath;
        if (!cwd) {
          vscode.window.showErrorMessage('No workspace folder open');
          return;
        }

        const command = `pks update ${file} --pack --constant ${constantName}`;
        exec(command, { cwd }, (error: Error | null, _stdout: string, stderr: string) => {
          if (error) {
            vscode.window.showErrorMessage(`Failed: ${stderr || error.message}`);
            return;
          }
          vscode.window.showInformationMessage(`Added ${constantName} to todo for pack`);
          packwerk.executeAll();
        });
      }
    )
  );

  // Register command: todo: pack -> pack
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'ruby.pks.todoPackToPack',
      async (file: string, definingPack: string) => {
        const cwd = vscode.workspace.rootPath;
        if (!cwd) {
          vscode.window.showErrorMessage('No workspace folder open');
          return;
        }

        const command = `pks update ${file} --pack --defining-pack ${definingPack}`;
        exec(command, { cwd }, (error: Error | null, _stdout: string, stderr: string) => {
          if (error) {
            vscode.window.showErrorMessage(`Failed: ${stderr || error.message}`);
            return;
          }
          vscode.window.showInformationMessage(`Added all ${definingPack} violations to todo`);
          packwerk.executeAll();
        });
      }
    )
  );

  // Register command: todo: all
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'ruby.pks.todoAll',
      async () => {
        const cwd = vscode.workspace.rootPath;
        if (!cwd) {
          vscode.window.showErrorMessage('No workspace folder open');
          return;
        }

        const command = 'pks update';
        exec(command, { cwd }, (error: Error | null, _stdout: string, stderr: string) => {
          if (error) {
            vscode.window.showErrorMessage(`Failed: ${stderr || error.message}`);
            return;
          }
          vscode.window.showInformationMessage('Updated all package_todo.yml files');
          packwerk.executeAll();
        });
      }
    )
  );

  const ws = vscode.workspace;

  ws.onDidChangeConfiguration(onDidChangeConfiguration(packwerk));

  // Run pks check for all files on activation
  packwerk.executeAll();

  ws.onDidSaveTextDocument((e: vscode.TextDocument) => {
    if (packwerk.isOnSave) {
      packwerk.execute(e);
    }
  });
}
