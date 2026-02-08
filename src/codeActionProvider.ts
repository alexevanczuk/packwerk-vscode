import * as vscode from 'vscode';
import { ViolationMetadata } from './packwerkOutput';

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

      const metadata = this.getViolationMetadata(diagnostic);

      // Check for privacy violation - offer to make constant public
      if (metadata?.violation_type === 'privacy' || this.isPrivacyViolation(diagnostic.message)) {
        const constantName = metadata?.constant_name || this.extractConstantName(diagnostic.message);
        if (constantName) {
          actions.push(this.createMakePublicAction(diagnostic, constantName));
        }
      }

      // Check for dependency violation - offer to add dependency
      if (metadata?.violation_type === 'dependency' || this.isDependencyViolation(diagnostic.message)) {
        const packInfo = metadata
          ? { sourcePack: metadata.referencing_pack_name, targetPack: metadata.defining_pack_name }
          : this.extractPackNames(document, diagnostic.message);
        if (packInfo) {
          actions.push(this.createAddDependencyAction(diagnostic, packInfo.sourcePack, packInfo.targetPack));
        }
      }

      // Add scoped update actions if we have metadata
      if (metadata) {
        actions.push(this.createScopedUpdateAction(diagnostic, metadata));
        actions.push(this.createPackUpdateAction(diagnostic, metadata));
      }
    }

    return actions;
  }

  private isPackwerkDiagnostic(diagnostic: vscode.Diagnostic): boolean {
    return diagnostic.source === 'packwerk';
  }

  private getViolationMetadata(diagnostic: vscode.Diagnostic): ViolationMetadata | undefined {
    return (diagnostic as any)._packwerk as ViolationMetadata | undefined;
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
    diagnostic: vscode.Diagnostic,
    constantName: string
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      'Make constant public with # pack_public: true',
      vscode.CodeActionKind.QuickFix
    );

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
    diagnostic: vscode.Diagnostic,
    sourcePack: string,
    targetPack: string
  ): vscode.CodeAction {
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
    const matchBackticks = message.match(/belongs to `([^`]+)`,.*?`([^`]+?)\/package\.yml`/);
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

  private createScopedUpdateAction(
    diagnostic: vscode.Diagnostic,
    metadata: ViolationMetadata
  ): vscode.CodeAction {
    const shortConstant = this.shortenConstantName(metadata.constant_name);
    const action = new vscode.CodeAction(
      `Allow ${metadata.violation_type} on ${shortConstant} for this file`,
      vscode.CodeActionKind.QuickFix
    );

    action.command = {
      title: 'Allow violation for file',
      command: 'ruby.packwerk.scopedUpdate',
      arguments: [metadata.file, metadata.constant_name, metadata.violation_type]
    };

    action.diagnostics = [diagnostic];
    action.isPreferred = true;

    return action;
  }

  private createPackUpdateAction(
    diagnostic: vscode.Diagnostic,
    metadata: ViolationMetadata
  ): vscode.CodeAction {
    const shortConstant = this.shortenConstantName(metadata.constant_name);
    const action = new vscode.CodeAction(
      `Allow ${metadata.violation_type} on ${shortConstant} for the pack`,
      vscode.CodeActionKind.QuickFix
    );

    action.command = {
      title: 'Allow violation for pack',
      command: 'ruby.packwerk.packUpdate',
      arguments: [metadata.file, metadata.constant_name, metadata.violation_type]
    };

    action.diagnostics = [diagnostic];

    return action;
  }

  // Shorten constant name for display (e.g., ::Foo::Bar::Baz -> Baz)
  private shortenConstantName(constantName: string): string {
    const parts = constantName.split('::').filter(p => p.length > 0);
    return parts.length > 0 ? parts[parts.length - 1] : constantName;
  }
}
