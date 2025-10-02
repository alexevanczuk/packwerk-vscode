import { expect } from 'chai';
import * as vscode from 'vscode';
import { PackwerkCodeActionProvider } from '../src/codeActionProvider';

describe('PackwerkCodeActionProvider', () => {
  let provider: PackwerkCodeActionProvider;

  beforeEach(() => {
    provider = new PackwerkCodeActionProvider();
  });

  describe('provideCodeActions', () => {
    it('should only provide pks update action for packwerk diagnostics', () => {
      // Create a mock document
      const document = {
        uri: vscode.Uri.file('/test/file.rb'),
        fileName: '/test/file.rb',
        isUntitled: false,
        languageId: 'ruby',
        version: 1,
        isDirty: false,
        isClosed: false,
      } as vscode.TextDocument;

      // Create packwerk diagnostic
      const packwerkDiagnostic = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 10),
        'Dependency violation: ::SomeConstant belongs to \'packs/foo\', but \'packs/bar\' does not specify a dependency',
        vscode.DiagnosticSeverity.Error
      );
      packwerkDiagnostic.source = 'packwerk';

      // Create non-packwerk diagnostic (e.g., RuboCop or TypeScript)
      const otherDiagnostic = new vscode.Diagnostic(
        new vscode.Range(1, 0, 1, 10),
        'Undefined variable: foo',
        vscode.DiagnosticSeverity.Error
      );
      otherDiagnostic.source = 'rubocop';

      const range = new vscode.Range(0, 0, 0, 10);
      const context: vscode.CodeActionContext = {
        diagnostics: [packwerkDiagnostic, otherDiagnostic]
      };

      const actions = provider.provideCodeActions(
        document,
        range,
        context,
        {} as vscode.CancellationToken
      );

      // Filter for "Run pks update" actions
      const pksUpdateActions = actions?.filter(
        action => action.title === 'Run pks update'
      ) || [];

      // Should only have ONE "Run pks update" action (from the packwerk diagnostic)
      expect(pksUpdateActions).to.have.lengthOf(1);
      expect(pksUpdateActions[0].diagnostics).to.deep.equal([packwerkDiagnostic]);
    });

    it('should provide privacy violation action only for packwerk privacy diagnostics', () => {
      const document = {
        uri: vscode.Uri.file('/test/file.rb'),
        fileName: '/test/file.rb',
        isUntitled: false,
        languageId: 'ruby',
        version: 1,
        isDirty: false,
        isClosed: false,
      } as vscode.TextDocument;

      const privacyDiagnostic = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 10),
        'Privacy violation: `::Foo::Bar` is private',
        vscode.DiagnosticSeverity.Error
      );
      privacyDiagnostic.source = 'packwerk';

      const otherDiagnostic = new vscode.Diagnostic(
        new vscode.Range(1, 0, 1, 10),
        'Line too long',
        vscode.DiagnosticSeverity.Warning
      );
      otherDiagnostic.source = 'rubocop';

      const range = new vscode.Range(0, 0, 0, 10);
      const context: vscode.CodeActionContext = {
        diagnostics: [privacyDiagnostic, otherDiagnostic]
      };

      const actions = provider.provideCodeActions(
        document,
        range,
        context,
        {} as vscode.CancellationToken
      );

      // Should have:
      // 1. Make constant public (for privacy violation)
      // 2. Run pks update (for privacy violation)
      // Total: 2 actions (none for the rubocop diagnostic)
      expect(actions).to.have.lengthOf(2);

      const makePublicActions = actions?.filter(
        action => action.title === 'Make constant public with # pack_public: true'
      ) || [];
      expect(makePublicActions).to.have.lengthOf(1);

      const pksUpdateActions = actions?.filter(
        action => action.title === 'Run pks update'
      ) || [];
      expect(pksUpdateActions).to.have.lengthOf(1);
    });

    it('should not provide any actions for non-packwerk diagnostics', () => {
      const document = {
        uri: vscode.Uri.file('/test/file.rb'),
        fileName: '/test/file.rb',
        isUntitled: false,
        languageId: 'ruby',
        version: 1,
        isDirty: false,
        isClosed: false,
      } as vscode.TextDocument;

      // Only non-packwerk diagnostics
      const diagnostic1 = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 10),
        'Syntax error',
        vscode.DiagnosticSeverity.Error
      );
      diagnostic1.source = 'ruby';

      const diagnostic2 = new vscode.Diagnostic(
        new vscode.Range(1, 0, 1, 10),
        'Style violation',
        vscode.DiagnosticSeverity.Warning
      );
      diagnostic2.source = 'rubocop';

      const range = new vscode.Range(0, 0, 0, 10);
      const context: vscode.CodeActionContext = {
        diagnostics: [diagnostic1, diagnostic2]
      };

      const actions = provider.provideCodeActions(
        document,
        range,
        context,
        {} as vscode.CancellationToken
      );

      // Should have no actions
      expect(actions).to.have.lengthOf(0);
    });
  });
});
