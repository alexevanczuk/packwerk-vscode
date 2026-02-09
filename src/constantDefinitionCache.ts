import * as vscode from 'vscode';
import { exec } from 'child_process';

export class ConstantDefinitionCache {
  private cache: Map<string, string> = new Map();
  private isLoading: boolean = false;
  private outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString();
    this.outputChannel.appendLine(`[${timestamp}] ${message}`);
  }

  public getDefinitionPath(constantName: string): string | undefined {
    // Normalize constant name - ensure it starts with ::
    const normalized = constantName.startsWith('::') ? constantName : `::${constantName}`;
    return this.cache.get(normalized);
  }

  public isReady(): boolean {
    return this.cache.size > 0 && !this.isLoading;
  }

  public refresh(): Promise<void> {
    return new Promise((resolve, reject) => {
      const cwd = vscode.workspace.rootPath;
      if (!cwd) {
        this.log('ConstantDefinitionCache: No workspace folder open');
        reject(new Error('No workspace folder open'));
        return;
      }

      if (this.isLoading) {
        this.log('ConstantDefinitionCache: Already loading, skipping');
        resolve();
        return;
      }

      this.isLoading = true;
      this.log('ConstantDefinitionCache: Loading definitions...');

      const command = 'pks list-definitions';
      exec(command, { cwd, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
        this.isLoading = false;

        if (error) {
          this.log(`ConstantDefinitionCache: Error running pks list-definitions: ${stderr || error.message}`);
          reject(error);
          return;
        }

        this.cache.clear();
        const lines = stdout.split('\n');
        let count = 0;

        for (const line of lines) {
          // Parse: "::ConstantName" is defined at "path/to/file.rb"
          const match = line.match(/^"(::[\w:]+)" is defined at "([^"]+)"$/);
          if (match) {
            const constantName = match[1];
            const filePath = match[2];
            this.cache.set(constantName, filePath);
            count++;
          }
        }

        this.log(`ConstantDefinitionCache: Loaded ${count} definitions`);
        resolve();
      });
    });
  }
}
