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
      if (!this.isPackwerkDiagnostic(diagnostic)) {
        continue;
      }

      const metadata = this.getViolationMetadata(diagnostic);
      if (!metadata) {
        continue;
      }

      const shortRefPack = this.shortenPackName(metadata.referencing_pack_name);
      const shortDefPack = this.shortenPackName(metadata.defining_pack_name);

      // 1. First action depends on violation type
      if (metadata.violation_type === 'dependency') {
        // Add: foo -> bar
        actions.push(this.createAddDependencyAction(
          diagnostic,
          metadata.referencing_pack_name,
          metadata.defining_pack_name,
          shortRefPack,
          shortDefPack
        ));
      } else if (metadata.violation_type === 'privacy') {
        // Make public: ::Bar
        actions.push(this.createMakePublicAction(diagnostic, metadata.constant_name));
      }

      // 2. todo: this file -> ::Bar
      actions.push(this.createTodoFileAction(diagnostic, metadata));

      // 3. todo: foo -> ::Bar
      actions.push(this.createTodoPackConstantAction(diagnostic, metadata, shortRefPack));

      // 4. todo: foo -> bar
      actions.push(this.createTodoPackToPackAction(diagnostic, metadata, shortRefPack, shortDefPack));

      // 5. todo: all
      actions.push(this.createTodoAllAction(diagnostic));
    }

    return actions;
  }

  private isPackwerkDiagnostic(diagnostic: vscode.Diagnostic): boolean {
    return diagnostic.source === 'packwerk';
  }

  private getViolationMetadata(diagnostic: vscode.Diagnostic): ViolationMetadata | undefined {
    return (diagnostic as any)._packwerk as ViolationMetadata | undefined;
  }

  // Remove "packs/" prefix for display
  private shortenPackName(packName: string): string {
    return packName.replace(/^packs\//, '');
  }

  // 1a. Add dependency action (for dependency violations)
  private createAddDependencyAction(
    diagnostic: vscode.Diagnostic,
    sourcePack: string,
    targetPack: string,
    shortSource: string,
    shortTarget: string
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      `Add: ${shortSource} -> ${shortTarget}`,
      vscode.CodeActionKind.QuickFix
    );

    action.command = {
      title: 'Add dependency',
      command: 'ruby.packwerk.addDependency',
      arguments: [sourcePack, targetPack]
    };

    action.diagnostics = [diagnostic];
    action.isPreferred = true;

    return action;
  }

  // 1b. Make public action (for privacy violations)
  private createMakePublicAction(
    diagnostic: vscode.Diagnostic,
    constantName: string
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      `Make public: ${constantName}`,
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

  // 2. todo: this file -> ::Bar
  private createTodoFileAction(
    diagnostic: vscode.Diagnostic,
    metadata: ViolationMetadata
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      `todo: this file -> ${metadata.constant_name}`,
      vscode.CodeActionKind.QuickFix
    );

    action.command = {
      title: 'Allow in file',
      command: 'ruby.packwerk.todoFile',
      arguments: [metadata.file, metadata.constant_name]
    };

    action.diagnostics = [diagnostic];

    return action;
  }

  // 3. todo: foo -> ::Bar
  private createTodoPackConstantAction(
    diagnostic: vscode.Diagnostic,
    metadata: ViolationMetadata,
    shortRefPack: string
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      `todo: ${shortRefPack} -> ${metadata.constant_name}`,
      vscode.CodeActionKind.QuickFix
    );

    action.command = {
      title: 'Allow in pack',
      command: 'ruby.packwerk.todoPackConstant',
      arguments: [metadata.file, metadata.constant_name]
    };

    action.diagnostics = [diagnostic];

    return action;
  }

  // 4. todo: foo -> bar
  private createTodoPackToPackAction(
    diagnostic: vscode.Diagnostic,
    metadata: ViolationMetadata,
    shortRefPack: string,
    shortDefPack: string
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      `todo: ${shortRefPack} -> ${shortDefPack}`,
      vscode.CodeActionKind.QuickFix
    );

    action.command = {
      title: 'Allow pack to pack',
      command: 'ruby.packwerk.todoPackToPack',
      arguments: [metadata.file, metadata.defining_pack_name]
    };

    action.diagnostics = [diagnostic];

    return action;
  }

  // 5. todo: all
  private createTodoAllAction(diagnostic: vscode.Diagnostic): vscode.CodeAction {
    const action = new vscode.CodeAction(
      'todo: all',
      vscode.CodeActionKind.QuickFix
    );

    action.command = {
      title: 'Update all todos',
      command: 'ruby.packwerk.todoAll',
      arguments: []
    };

    action.diagnostics = [diagnostic];

    return action;
  }
}
