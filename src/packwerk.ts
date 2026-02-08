import {
  PackwerkOutput,
  PackwerkViolation,
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
  private taskQueue: TaskQueue = new TaskQueue();
  private output: vscode.OutputChannel;

  constructor(
    diagnostics: vscode.DiagnosticCollection,
    outputChannel: vscode.OutputChannel,
  ) {
    this.diag = diagnostics;
    this.output = outputChannel;
    this.config = getConfig();
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString();
    this.output.appendLine(`[${timestamp}] ${message}`);
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

      this.log(`executeAll: Parsed ${packwerk.violations?.length || 0} violations`);

      this.diag.clear();

      // Group violations by file
      const byFile = new Map<string, vscode.Diagnostic[]>();
      packwerk.violations.forEach((offence: PackwerkViolation) => {
        const range = new vscode.Range(
          offence.line - 1,
          offence.column,
          offence.line - 1,
          offence.constant_name.length + offence.column
        );

        const diagnostic = new vscode.Diagnostic(
          range,
          offence.message,
          vscode.DiagnosticSeverity.Error
        );
        diagnostic.source = 'packwerk';

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
      let command = `${this.config.executable} check --json`;
      this.log(`executeAll: Running command: ${command}`);
      let process = cp.exec(command, { cwd, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (token.isCanceled) {
          this.log('executeAll: Task was canceled');
          return;
        }
        onDidExec(error, stdout, stderr);
        token.finished();
        if (onComplete) {
          onComplete();
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
      console.debug(`[DEBUG] Finished running command, in onDidExec`)
      console.debug(`[DEBUG] Error, stderr`, error, stderr)
      this.reportError(error, stderr);
      let packwerk = this.parse(stdout);
      if (packwerk === undefined || packwerk === null) {
        console.debug(`[DEBUG] packwerk is undefined or null, returning from onDidExec`)
        return;
      }

      this.diag.delete(uri);

      let diagnostics: vscode.Diagnostic[] = [];
      packwerk.violations.forEach((offence: PackwerkViolation) => {
        const range = new vscode.Range(
          offence.line - 1,
          offence.column,
          offence.line - 1,
          offence.constant_name.length + offence.column
        );

        console.debug(`[DEBUG] Adding vscode.Diagnostic:`, { range, message: offence.message })
        const diagnostic = new vscode.Diagnostic(
          range,
          offence.message,
          vscode.DiagnosticSeverity.Error
        );
        diagnostic.source = 'packwerk';
        diagnostics.push(diagnostic);
      });
      this.diag.set(uri, diagnostics);
    };

    let task = new Task(uri, (token) => {
      let process = this.executePackwerkCheck(
        relativeFileName,
        document.getText(),
        { cwd: currentPath },
        (error, stdout, stderr) => {
          if (token.isCanceled) {
            return;
          }
          onDidExec(error, stdout, stderr);
          token.finished();
          if (onComplete) {
            onComplete();
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
    let command = `${this.config.executable} check --json ${fileName}`
    console.debug(`[DEBUG] Running command ${command}`)

    let child = cp.exec(command, { ...options, maxBuffer: 50 * 1024 * 1024 }, cb);
    child.stdin.write(fileContents); // why do we need this?
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
    let errorOutput = stderr.toString();
    if (error && (<any>error).code === 'ENOENT') {
      vscode.window.showWarningMessage(
        `${this.config.executable} is not executable`
      );
      return true;
    } else if (error && (<any>error).code === 127 && this.config.showWarnings) {
      console.debug('[DEBUG] Showing error with code 127', stderr)
      vscode.window.showWarningMessage(stderr);
      return true;
    } else if (errorOutput.length > 0 && this.config.showWarnings) {
      console.debug('[DEBUG] Showing error with errorOutput.length > 0', stderr)
      vscode.window.showWarningMessage(stderr);
      return true;
    }

    return false;
  }
}
