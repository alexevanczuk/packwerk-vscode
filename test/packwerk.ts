import { expect } from 'chai';
import * as vscode from 'vscode';
import { Packwerk } from '../src/packwerk';

describe('Packwerk', () => {
  let instance: Packwerk;
  let diagnostics: vscode.DiagnosticCollection;
  let outputChannel: vscode.OutputChannel;

  beforeEach(() => {
    diagnostics = vscode.languages.createDiagnosticCollection();
    outputChannel = vscode.window.createOutputChannel('Pks Test');
    instance = new Packwerk(diagnostics, outputChannel);
  });

  describe('initialization', () => {
    describe('.diag', () => {
      it('is set to the provided DiagnosticCollection', () => {
        expect(instance).to.have.property('diag', diagnostics);
      });
    });
  });
});
