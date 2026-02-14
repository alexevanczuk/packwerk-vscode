import { expect } from 'chai';
import * as vscode from 'vscode';
import { Pks } from '../src/pks';

describe('Pks', () => {
  let instance: Pks;
  let diagnostics: vscode.DiagnosticCollection;
  let outputChannel: vscode.OutputChannel;

  beforeEach(() => {
    diagnostics = vscode.languages.createDiagnosticCollection();
    outputChannel = vscode.window.createOutputChannel('Pks Test');
    instance = new Pks(diagnostics, outputChannel);
  });

  describe('initialization', () => {
    describe('.diag', () => {
      it('is set to the provided DiagnosticCollection', () => {
        expect(instance).to.have.property('diag', diagnostics);
      });
    });
  });
});
