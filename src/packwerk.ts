import {
  PackwerkOutput,
  PackwerkViolation,
  ViolationMetadata,
} from './packwerkOutput';
import { TaskQueue, Task } from './taskQueue';
import * as cp from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { getConfig, PackwerkConfig } from './configuration';
import { parseOutput } from './outputParser';

function isFileUri(uri: vscode.Uri): boolean {
  return uri.scheme === 'file';
}

function getCurrentPath(fileName: string): string {
  return vscode.workspace.rootPath || path.dirname(fileName);
}

export class Packwerk {
  public config: PackwerkConfig;
  private diag: vscode.DiagnosticCollection;
  private taskQueue: TaskQueue;
  private output: vscode.OutputChannel;

  constructor(
    diagnostics: vscode.DiagnosticCollection,
    outputChannel: vscode.OutputChannel,
  ) {
    this.diag = diagnostics;
    this.output = outputChannel;
    this.config = getConfig();
    this.taskQueue = new TaskQueue((msg) => this.log(msg));
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString();
    this.output.appendLine(`[${timestamp}] ${message}`);
  }

  // Check if a violation has valid line/column info for display
  private hasValidLocation(violation: PackwerkViolation): boolean {
    return typeof violation.line === 'number' && typeof violation.column === 'number';
  }

  // Strip the "file:line:column\n" prefix from violation messages since it's redundant
  private cleanMessage(message: string): string {
    const newlineIndex = message.indexOf('\n');
    if (newlineIndex !== -1) {
      return message.substring(newlineIndex + 1);
    }
    return message;
  }

  // Create a diagnostic with violation metadata attached for code actions
  private createDiagnostic(
    offence: PackwerkViolation,
    severity: vscode.DiagnosticSeverity = vscode.DiagnosticSeverity.Error
  ): vscode.Diagnostic {
    const range = new vscode.Range(
      offence.line - 1,
      offence.column,
      offence.line - 1,
      offence.constant_name.length + offence.column
    );

    const diagnostic = new vscode.Diagnostic(
      range,
      this.cleanMessage(offence.message),
      severity
    );
    diagnostic.source = 'packwerk';

    // Store violation metadata for code actions
    const metadata: ViolationMetadata = {
      file: offence.file,
      violation_type: offence.violation_type,
      constant_name: offence.constant_name,
      referencing_pack_name: offence.referencing_pack_name,
      defining_pack_name: offence.defining_pack_name,
    };
    (diagnostic as any)._packwerk = metadata;

    return diagnostic;
  }

  // Execute pks check and populate a specific diagnostic collection with given severity
  public executeAllToCollection(
    targetDiag: vscode.DiagnosticCollection,
    severity: vscode.DiagnosticSeverity,
    onComplete?: () => void
  ): void {
    let currentPath = vscode.workspace.rootPath;
    if (!currentPath) {
      this.log('executeAllToCollection: No workspace root path, aborting');
      return;
    }

    const cwd = currentPath;
    const allUri = vscode.Uri.parse('packwerk:highlights');

    this.log(`executeAllToCollection: Starting in cwd=${cwd}`);

    let onDidExec = (error: Error, stdout: string, stderr: string) => {
      this.log(`executeAllToCollection: Command finished`);
      this.reportError(error, stderr);
      let packwerk = this.parse(stdout);
      if (packwerk === undefined || packwerk === null) {
        this.log('executeAllToCollection: Parse returned null/undefined, aborting');
        return;
      }

      const allViolations = [
        ...(packwerk.violations || []),
        ...(packwerk.stale_violations || []),
        ...(packwerk.strict_mode_violations || []),
      ].filter(v => this.hasValidLocation(v));

      this.log(`executeAllToCollection: Parsed ${allViolations.length} displayable violations`);

      targetDiag.clear();

      const byFile = new Map<string, vscode.Diagnostic[]>();
      allViolations.forEach((offence: PackwerkViolation) => {
        const diagnostic = this.createDiagnostic(offence, severity);

        if (!byFile.has(offence.file)) {
          byFile.set(offence.file, []);
        }
        byFile.get(offence.file)!.push(diagnostic);
      });

      let entries: [vscode.Uri, vscode.Diagnostic[]][] = [];
      byFile.forEach((diagnostics, file) => {
        const fileUri = vscode.Uri.file(cwd + '/' + file);
        entries.push([fileUri, diagnostics]);
      });

      this.log(`executeAllToCollection: Setting diagnostics for ${entries.length} files`);
      targetDiag.set(entries);
    };

    let task = new Task(allUri, (token) => {
      let command = `${this.config.executable} --json`;
      this.log(`executeAllToCollection: Running command: ${command}`);
      let process = cp.exec(command, { cwd, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
        try {
          if (token.isCanceled) {
            this.log('executeAllToCollection: Task was canceled');
            return;
          }
          onDidExec(error, stdout, stderr);
          if (onComplete) {
            onComplete();
          }
        } catch (e) {
          this.log(`executeAllToCollection: Exception in callback: ${e}`);
        } finally {
          token.finished();
        }
      });
      return () => process.kill();
    });

    this.taskQueue.enqueue(task);
  }

  public executeAll(onComplete?: () => void): void {
    let currentPath = vscode.workspace.rootPath;
    if (!currentPath) {
      this.log('executeAll: No workspace root path, aborting');
      return;
    }

    const cwd = currentPath;
    // Sentinel URI used for task queue cancellation of whole-workspace runs
    const allUri = vscode.Uri.parse('packwerk:all');

    this.log(`executeAll: Starting in cwd=${cwd}`);

    let onDidExec = (error: Error, stdout: string, stderr: string) => {
      this.log(`executeAll: Command finished. error=${error?.message || 'none'}, stdout.length=${stdout?.length || 0}, stderr.length=${stderr?.length || 0}`);
      if (error) {
        this.log(`executeAll: Error details: code=${(error as any).code}, signal=${(error as any).signal}`);
      }
      if (stderr && stderr.length > 0) {
        this.log(`executeAll: stderr=${stderr.substring(0, 500)}`);
      }

      this.reportError(error, stderr);
      let packwerk = this.parse(stdout);
      if (packwerk === undefined || packwerk === null) {
        this.log('executeAll: Parse returned null/undefined, aborting');
        return;
      }

      // Combine all violation types and filter to those with valid locations
      const allViolations = [
        ...(packwerk.violations || []),
        ...(packwerk.stale_violations || []),
        ...(packwerk.strict_mode_violations || []),
      ].filter(v => this.hasValidLocation(v));

      this.log(`executeAll: Parsed ${allViolations.length} displayable violations (${packwerk.violations?.length || 0} new, ${packwerk.stale_violations?.length || 0} stale, ${packwerk.strict_mode_violations?.length || 0} strict)`);

      this.diag.clear();

      // Group violations by file
      const byFile = new Map<string, vscode.Diagnostic[]>();
      allViolations.forEach((offence: PackwerkViolation) => {
        const diagnostic = this.createDiagnostic(offence);

        if (!byFile.has(offence.file)) {
          byFile.set(offence.file, []);
        }
        byFile.get(offence.file)!.push(diagnostic);
      });

      let entries: [vscode.Uri, vscode.Diagnostic[]][] = [];
      byFile.forEach((diagnostics, file) => {
        const fileUri = vscode.Uri.file(cwd + '/' + file);
        entries.push([fileUri, diagnostics]);
      });

      this.log(`executeAll: Setting diagnostics for ${entries.length} files`);
      this.diag.set(entries);
      this.log('executeAll: Done');
    };

    let task = new Task(allUri, (token) => {
      let command = `${this.config.executable} --json`;
      this.log(`executeAll: Running command: ${command}`);
      let process = cp.exec(command, { cwd, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
        try {
          if (token.isCanceled) {
            this.log('executeAll: Task was canceled');
            return;
          }
          onDidExec(error, stdout, stderr);
          if (onComplete) {
            onComplete();
          }
        } catch (e) {
          this.log(`executeAll: Exception in callback: ${e}`);
        } finally {
          token.finished();
        }
      });
      return () => process.kill();
    });

    this.taskQueue.enqueue(task);
  }

  public execute(document: vscode.TextDocument, onComplete?: () => void): void {
    if (
      (document.languageId !== 'gemfile' && document.languageId !== 'ruby') ||
      document.isUntitled ||
      !isFileUri(document.uri)
    ) {
      // git diff has ruby-mode. but it is Untitled file.
      return;
    }

    const fileName = document.fileName;
    const uri = document.uri;
    let currentPath = getCurrentPath(fileName);
    let relativeFileName = fileName.replace(currentPath + '/', '')

    let onDidExec = (error: Error, stdout: string, stderr: string) => {
      this.log(`execute: Command finished for ${relativeFileName}`);
      this.reportError(error, stderr);
      let packwerk = this.parse(stdout);
      if (packwerk === undefined || packwerk === null) {
        this.log('execute: Parse returned null/undefined, aborting');
        return;
      }

      // Combine all violation types and filter to those with valid locations
      const allViolations = [
        ...(packwerk.violations || []),
        ...(packwerk.stale_violations || []),
        ...(packwerk.strict_mode_violations || []),
      ].filter(v => this.hasValidLocation(v));

      this.diag.delete(uri);

      const diagnostics = allViolations.map((offence: PackwerkViolation) =>
        this.createDiagnostic(offence)
      );
      this.log(`execute: Setting ${diagnostics.length} diagnostics for ${relativeFileName}`);
      this.diag.set(uri, diagnostics);
    };

    let task = new Task(uri, (token) => {
      let process = this.executePackwerkCheck(
        relativeFileName,
        document.getText(),
        { cwd: currentPath },
        (error, stdout, stderr) => {
          try {
            if (token.isCanceled) {
              return;
            }
            onDidExec(error, stdout, stderr);
            if (onComplete) {
              onComplete();
            }
          } catch (e) {
            this.log(`execute: Exception in callback: ${e}`);
          } finally {
            token.finished();
          }
        }
      );
      return () => process.kill();
    });

    this.taskQueue.enqueue(task);
  }

  public get isOnSave(): boolean {
    return this.config.onSave;
  }

  public clear(document: vscode.TextDocument): void {
    let uri = document.uri;
    if (isFileUri(uri)) {
      this.taskQueue.cancel(uri);
      this.diag.delete(uri);
    }
  }

  private executePackwerkCheck(
    fileName: string,
    fileContents: string,
    options: cp.ExecOptions,
    cb: (err: Error, stdout: string, stderr: string) => void
  ): cp.ChildProcess {
    let command = `${this.config.executable} --json ${fileName}`;
    this.log(`executePackwerkCheck: Running command: ${command}`);

    let child = cp.exec(command, { ...options, maxBuffer: 50 * 1024 * 1024 }, cb);
    child.stdin.write(fileContents);
    child.stdin.end();
    return child;
  }

  private parse(output: string): PackwerkOutput | null {
    let packwerk: PackwerkOutput;
    this.log(`parse: output.length=${output?.length || 0}`);

    if (output.length < 1) {
      this.log('parse: Output is empty');
      let message = `command ${this.config.executable} returns empty output! please check configuration.`;
      this.log(`parse: ${message}`);
      // For now, we do not show this error message. There are lots of reasons why this could fail, so
      // we turn it off so as to not bother the user
      // vscode.window.showWarningMessage(message);

      return null;
    }

    try {
      this.log(`parse: Attempting JSON parse, first 200 chars: ${output.substring(0, 200)}`);
      packwerk = parseOutput(output);
      this.log(`parse: JSON parse succeeded, status=${packwerk?.status}, violations count=${packwerk?.violations?.length}`);
    } catch (e) {
      this.log(`parse: JSON parse failed with error: ${e}`);
      if (e instanceof SyntaxError) {
        let regex = /[\r\n \t]/g;
        let message = output.replace(regex, ' ').substring(0, 500);
        let errorMessage = `Error on parsing output (It might non-JSON output) : "${message}"`;
        this.log(`parse: ${errorMessage}`);
        vscode.window.showWarningMessage(errorMessage);

        return null;
      }
    }

    return packwerk;
  }

  private reportError(error: Error, stderr: string): boolean {
    if (error && (<any>error).code === 'ENOENT') {
      vscode.window.showWarningMessage(
        `${this.config.executable} is not executable`
      );
      return true;
    } else if (error && (<any>error).code === 127) {
      vscode.window.showWarningMessage(stderr);
      return true;
    }

    return false;
  }
}
