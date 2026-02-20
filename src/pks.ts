import {
  PksOutput,
  PksValidateOutput,
  PksViolation,
  CycleDiagnosticMetadata,
  ViolationMetadata,
} from './pksOutput';
import { TaskQueue, Task } from './taskQueue';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getConfig, PksConfig } from './configuration';
import { parseOutput } from './outputParser';

function isFileUri(uri: vscode.Uri): boolean {
  return uri.scheme === 'file';
}

function getCurrentPath(fileName: string): string {
  return vscode.workspace.rootPath || path.dirname(fileName);
}

export class Pks {
  public config: PksConfig;
  private diag: vscode.DiagnosticCollection;
  private validateDiag: vscode.DiagnosticCollection;
  private taskQueue: TaskQueue;
  private output: vscode.OutputChannel;

  constructor(
    diagnostics: vscode.DiagnosticCollection,
    validateDiagnostics: vscode.DiagnosticCollection,
    outputChannel: vscode.OutputChannel,
  ) {
    this.diag = diagnostics;
    this.validateDiag = validateDiagnostics;
    this.output = outputChannel;
    this.config = getConfig();
    this.taskQueue = new TaskQueue((msg) => this.log(msg));
  }

  // Get the base executable (e.g., "pks") by stripping trailing " check" from config
  public getBaseExecutable(): string {
    const exe = this.config.executable;
    if (exe.endsWith(' check')) {
      return exe.slice(0, -6);
    }
    return exe;
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString();
    this.output.appendLine(`[${timestamp}] ${message}`);
  }

  // Check if a violation has valid line/column info for display
  private hasValidLocation(violation: PksViolation): boolean {
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
    offence: PksViolation,
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
    diagnostic.source = 'pks';

    // Store violation metadata for code actions
    const metadata: ViolationMetadata = {
      file: offence.file,
      violation_type: offence.violation_type,
      constant_name: offence.constant_name,
      referencing_pack_name: offence.referencing_pack_name,
      defining_pack_name: offence.defining_pack_name,
    };
    (diagnostic as any)._pks = metadata;

    return diagnostic;
  }

  // Execute pks check with --ignore-recorded-violations on a single file
  // Returns both ranges (for decorations) and diagnostics (for Error Lens)
  public executeHighlights(
    document: vscode.TextDocument,
    onResults: (ranges: vscode.Range[], diagnostics: vscode.Diagnostic[]) => void,
    onComplete?: () => void
  ): void {
    if (
      (document.languageId !== 'gemfile' && document.languageId !== 'ruby') ||
      document.isUntitled ||
      !isFileUri(document.uri)
    ) {
      onResults([], []);
      return;
    }

    const fileName = document.fileName;
    const uri = document.uri;
    let currentPath = getCurrentPath(fileName);
    let relativeFileName = fileName.replace(currentPath + '/', '');

    let onDidExec = (error: Error, stdout: string, stderr: string) => {
      this.log(`executeHighlights: Command finished for ${relativeFileName}`);
      this.reportError(error, stderr);
      let pksOutput = this.parse(stdout);
      if (pksOutput === undefined || pksOutput === null) {
        this.log('executeHighlights: Parse returned null/undefined, aborting');
        onResults([], []);
        return;
      }

      const allViolations = [
        ...(pksOutput.violations || []),
        ...(pksOutput.stale_violations || []),
        ...(pksOutput.strict_mode_violations || []),
      ].filter(v => this.hasValidLocation(v));

      const ranges: vscode.Range[] = [];
      const diagnostics: vscode.Diagnostic[] = [];

      allViolations.forEach((offence: PksViolation) => {
        // Get the constant name without leading ::
        const displayName = offence.constant_name.replace(/^::/, '');
        const range = new vscode.Range(
          offence.line - 1,
          offence.column,
          offence.line - 1,
          offence.column + displayName.length
        );
        ranges.push(range);

        // Create diagnostic for Error Lens (use Information severity for blue icon)
        const diagnostic = new vscode.Diagnostic(
          range,
          this.cleanMessage(offence.message),
          vscode.DiagnosticSeverity.Information
        );
        diagnostic.source = 'pks';

        // Attach violation metadata for code actions
        const metadata: ViolationMetadata = {
          file: offence.file,
          violation_type: offence.violation_type,
          constant_name: offence.constant_name,
          referencing_pack_name: offence.referencing_pack_name,
          defining_pack_name: offence.defining_pack_name,
        };
        (diagnostic as any)._pks = metadata;

        diagnostics.push(diagnostic);
      });

      this.log(`executeHighlights: Found ${ranges.length} violations for ${relativeFileName}`);
      onResults(ranges, diagnostics);
    };

    let task = new Task(uri, (token) => {
      // Use --ignore-recorded-violations to show all violations including those in package_todo.yml
      let command = `${this.config.executable} --json --ignore-recorded-violations ${relativeFileName}`;
      this.log(`executeHighlights: Running command: ${command}`);
      let process = cp.exec(command, { cwd: currentPath, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
        try {
          if (token.isCanceled) {
            return;
          }
          onDidExec(error, stdout, stderr);
          if (onComplete) {
            onComplete();
          }
        } catch (e) {
          this.log(`executeHighlights: Exception in callback: ${e}`);
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
    const allUri = vscode.Uri.parse('pks:all');

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
      let pksOutput = this.parse(stdout);
      if (pksOutput === undefined || pksOutput === null) {
        this.log('executeAll: Parse returned null/undefined, aborting');
        return;
      }

      // Combine all violation types and filter to those with valid locations
      const allViolations = [
        ...(pksOutput.violations || []),
        ...(pksOutput.stale_violations || []),
        ...(pksOutput.strict_mode_violations || []),
      ].filter(v => this.hasValidLocation(v));

      this.log(`executeAll: Parsed ${allViolations.length} displayable violations (${pksOutput.violations?.length || 0} new, ${pksOutput.stale_violations?.length || 0} stale, ${pksOutput.strict_mode_violations?.length || 0} strict)`);

      this.diag.clear();

      // Group violations by file
      const byFile = new Map<string, vscode.Diagnostic[]>();
      allViolations.forEach((offence: PksViolation) => {
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

    // Also run validate after check
    this.executeValidate();
  }

  public executeValidate(onComplete?: () => void): void {
    let currentPath = vscode.workspace.rootPath;
    if (!currentPath) {
      this.log('executeValidate: No workspace root path, aborting');
      return;
    }

    const cwd = currentPath;
    const validateUri = vscode.Uri.parse('pks:validate');
    const baseExe = this.getBaseExecutable();

    this.log(`executeValidate: Starting in cwd=${cwd}`);

    let onDidExec = (error: Error, stdout: string, stderr: string) => {
      this.log(`executeValidate: Command finished. stdout.length=${stdout?.length || 0}`);
      if (stderr && stderr.length > 0) {
        this.log(`executeValidate: stderr=${stderr.substring(0, 500)}`);
      }

      this.validateDiag.clear();

      if (!stdout || stdout.length < 1) {
        this.log('executeValidate: Empty output');
        return;
      }

      let validateOutput: PksValidateOutput;
      try {
        validateOutput = JSON.parse(stdout);
      } catch (e) {
        this.log(`executeValidate: JSON parse failed: ${e}`);
        return;
      }

      if (!validateOutput.validation_errors || validateOutput.validation_errors.length === 0) {
        this.log('executeValidate: No validation errors');
        return;
      }

      const byFile = new Map<string, vscode.Diagnostic[]>();

      for (const validationError of validateOutput.validation_errors) {
        if (validationError.error_type !== 'cycle' || !validationError.cycle_edges) {
          continue;
        }

        for (const edge of validationError.cycle_edges) {
          const filePath = path.join(cwd, edge.file);

          // Read the package.yml to find the dependency line
          let fileContent: string;
          try {
            fileContent = fs.readFileSync(filePath, 'utf-8');
          } catch (e) {
            this.log(`executeValidate: Could not read ${filePath}: ${e}`);
            continue;
          }

          const lines = fileContent.split('\n');
          let inDependencies = false;
          let foundLine = -1;
          let startChar = 0;
          let endChar = 0;

          for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];

            if (/^dependencies:/.test(line)) {
              inDependencies = true;
              continue;
            }

            if (inDependencies && /^[^\s-]/.test(line)) {
              inDependencies = false;
            }

            if (inDependencies) {
              // Match dependency lines like "  - packs/foo" or "  - 'packs/foo'"
              const match = line.match(/^(\s*-\s*)["']?([^"'\s]+)["']?\s*$/);
              if (match && match[2] === edge.to_pack) {
                foundLine = lineNum;
                startChar = match[1].length;
                endChar = startChar + match[2].length;
                break;
              }
            }
          }

          if (foundLine === -1) {
            this.log(`executeValidate: Could not find dependency line for ${edge.to_pack} in ${edge.file}`);
            continue;
          }

          const range = new vscode.Range(
            new vscode.Position(foundLine, startChar),
            new vscode.Position(foundLine, endChar)
          );

          const diagnostic = new vscode.Diagnostic(
            range,
            `Dependency cycle: ${edge.from_pack} -> ${edge.to_pack}`,
            vscode.DiagnosticSeverity.Error
          );
          diagnostic.source = 'pks-validate';

          // Attach cycle metadata for code actions
          const cycleMeta: CycleDiagnosticMetadata = {
            from_pack: edge.from_pack,
            to_pack: edge.to_pack,
          };
          (diagnostic as any)._pksCycle = cycleMeta;

          const fileUri = vscode.Uri.file(filePath).toString();
          if (!byFile.has(fileUri)) {
            byFile.set(fileUri, []);
          }
          byFile.get(fileUri)!.push(diagnostic);
        }
      }

      let entries: [vscode.Uri, vscode.Diagnostic[]][] = [];
      byFile.forEach((diagnostics, fileUriStr) => {
        entries.push([vscode.Uri.parse(fileUriStr), diagnostics]);
      });

      this.log(`executeValidate: Setting diagnostics for ${entries.length} files`);
      this.validateDiag.set(entries);
      this.log('executeValidate: Done');
    };

    let task = new Task(validateUri, (token) => {
      let command = `${baseExe} validate --json`;
      this.log(`executeValidate: Running command: ${command}`);
      let process = cp.exec(command, { cwd, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
        try {
          if (token.isCanceled) {
            this.log('executeValidate: Task was canceled');
            return;
          }
          onDidExec(error, stdout, stderr);
          if (onComplete) {
            onComplete();
          }
        } catch (e) {
          this.log(`executeValidate: Exception in callback: ${e}`);
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
      let pksOutput = this.parse(stdout);
      if (pksOutput === undefined || pksOutput === null) {
        this.log('execute: Parse returned null/undefined, aborting');
        return;
      }

      // Combine all violation types and filter to those with valid locations
      const allViolations = [
        ...(pksOutput.violations || []),
        ...(pksOutput.stale_violations || []),
        ...(pksOutput.strict_mode_violations || []),
      ].filter(v => this.hasValidLocation(v));

      this.diag.delete(uri);

      const diagnostics = allViolations.map((offence: PksViolation) =>
        this.createDiagnostic(offence)
      );
      this.log(`execute: Setting ${diagnostics.length} diagnostics for ${relativeFileName}`);
      this.diag.set(uri, diagnostics);
    };

    let task = new Task(uri, (token) => {
      let process = this.executePksCheck(
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

  private executePksCheck(
    fileName: string,
    fileContents: string,
    options: cp.ExecOptions,
    cb: (err: Error, stdout: string, stderr: string) => void
  ): cp.ChildProcess {
    let command = `${this.config.executable} --json ${fileName}`;
    this.log(`executePksCheck: Running command: ${command}`);

    let child = cp.exec(command, { ...options, maxBuffer: 50 * 1024 * 1024 }, cb);
    child.stdin.write(fileContents);
    child.stdin.end();
    return child;
  }

  private parse(output: string): PksOutput | null {
    let pksOutput: PksOutput;
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
      pksOutput = parseOutput(output);
      this.log(`parse: JSON parse succeeded, status=${pksOutput?.status}, violations count=${pksOutput?.violations?.length}`);
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

    return pksOutput;
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
