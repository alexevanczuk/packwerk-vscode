import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';

export class PackwerkCodeActionProvider implements vscode.CodeActionProvider {
  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.CodeAction[] | undefined {
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      // Only provide actions for packwerk diagnostics
      if (!this.isPackwerkDiagnostic(diagnostic)) {
        continue;
      }

      const message = diagnostic.message;

      // Check for privacy violation
      if (this.isPrivacyViolation(message)) {
        actions.push(this.createMakePublicAction(document, diagnostic));
      }

      // Check for dependency violation
      if (this.isDependencyViolation(message)) {
        const addDepAction = this.createAddDependencyAction(document, diagnostic, message);
        if (addDepAction) {
          actions.push(addDepAction);
        }
      }

      // Add "Run pks update" action for any packwerk violation
      actions.push(this.createRunPksUpdateAction(document, diagnostic));
    }

    return actions;
  }

  private isPackwerkDiagnostic(diagnostic: vscode.Diagnostic): boolean {
    return diagnostic.source === 'packwerk';
  }

  private isPrivacyViolation(message: string): boolean {
    return message.includes('Privacy violation') ||
           message.includes('privacy violation') ||
           message.includes('private constant');
  }

  private isDependencyViolation(message: string): boolean {
    return message.includes('Dependency violation') ||
           message.includes('dependency violation') ||
           message.includes('not listed as a dependency');
  }

  private createMakePublicAction(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      'Make constant public with # pack_public: true',
      vscode.CodeActionKind.QuickFix
    );

    // Extract constant name from the diagnostic message
    const constantName = this.extractConstantName(diagnostic.message);

    action.command = {
      title: 'Make constant public',
      command: 'ruby.packwerk.makePublic',
      arguments: [constantName]
    };

    action.diagnostics = [diagnostic];
    action.isPreferred = true;

    return action;
  }

  private extractConstantName(message: string): string | undefined {
    // Extract constant name from privacy violation message
    // Example: "Privacy violation: `::Cryptography::AegisJwt::Encode` is private"
    const match = message.match(/[`']::([^`']+)[`']/);
    if (match) {
      return '::' + match[1];
    }

    // Try without leading ::
    const match2 = message.match(/[`']([A-Z][^`']*)[`']/);
    if (match2) {
      return match2[1];
    }

    return undefined;
  }

  private createAddDependencyAction(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic,
    message: string
  ): vscode.CodeAction | undefined {
    // Try to parse pack names from the message
    // Common formats:
    // "Dependency violation: ::SomeConstant belongs to 'packs/target', but 'packs/source' does not specify a dependency"
    // We need to extract source and target pack names

    const packInfo = this.extractPackNames(document, message);
    if (!packInfo) {
      return undefined;
    }

    const { sourcePack, targetPack } = packInfo;

    const action = new vscode.CodeAction(
      `Add dependency from ${sourcePack} to ${targetPack}`,
      vscode.CodeActionKind.QuickFix
    );

    action.command = {
      title: 'Add dependency',
      command: 'ruby.packwerk.addDependency',
      arguments: [sourcePack, targetPack]
    };

    action.diagnostics = [diagnostic];

    return action;
  }

  private extractPackNames(
    document: vscode.TextDocument,
    message: string
  ): { sourcePack: string; targetPack: string } | undefined {
    // Try to extract pack names from message
    // Example with backticks: "belongs to `packs/foo`, but `packs/bar/package.yml` does not"
    const matchBackticks = message.match(/belongs to `([^`]+)`,.*?`([^`\/]+(?:\/[^`\/]+)?)/);
    if (matchBackticks) {
      return { sourcePack: matchBackticks[2], targetPack: matchBackticks[1] };
    }

    // Example with quotes: "belongs to 'packs/foo', but 'packs/bar' does not"
    const match = message.match(/belongs to '([^']+)',.*?'([^']+)'/);
    if (match) {
      return { sourcePack: match[2], targetPack: match[1] };
    }

    // Try alternative format: "from 'packs/bar' to 'packs/foo'"
    const match2 = message.match(/from '([^']+)' to '([^']+)'/);
    if (match2) {
      return { sourcePack: match2[1], targetPack: match2[2] };
    }

    // Fallback: try to infer source pack from file path
    const sourcePack = this.getPackFromFilePath(document.uri.fsPath);
    if (!sourcePack) {
      return undefined;
    }

    // Try to extract target pack (with backticks)
    const targetMatchBacktick = message.match(/(?:belongs to|to) `([^`]+)`/);
    if (targetMatchBacktick) {
      return { sourcePack, targetPack: targetMatchBacktick[1] };
    }

    // Try to extract target pack (with quotes)
    const targetMatch = message.match(/(?:belongs to|to) '([^']+)'/);
    if (targetMatch) {
      return { sourcePack, targetPack: targetMatch[1] };
    }

    return undefined;
  }

  private getPackFromFilePath(filePath: string): string | undefined {
    // Find the pack directory (e.g., packs/foo from packs/foo/app/models/bar.rb)
    const match = filePath.match(/packs\/[^\/]+/);
    return match ? match[0] : undefined;
  }

  private createRunPksUpdateAction(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      'Run pks update',
      vscode.CodeActionKind.QuickFix
    );

    action.command = {
      title: 'Run pks update',
      command: 'ruby.packwerk.runPksUpdate',
      arguments: []
    };

    action.diagnostics = [diagnostic];

    return action;
  }
}
