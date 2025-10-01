import { expect } from 'chai';
import { findSigilInsertionLine } from '../src/fileHeaderUtils';

describe('fileHeaderUtils', () => {
  describe('findSigilInsertionLine', () => {
    it('inserts after typed and frozen_string_literal headers', () => {
      const lines = [
        '# typed: strict',
        '# frozen_string_literal: true',
        '',
        'module Cryptography',
        '  module AegisJwt',
      ];

      const result = findSigilInsertionLine(lines);

      // We want line 2 (the blank line), but we should REPLACE it, not insert before it
      expect(result).to.equal(2);

      // Simulate REPLACING line 2 with splice(index, deleteCount, ...items)
      const newLines = [...lines];
      newLines.splice(result, 1, '# pack_public: true', '');

      // Expected result:
      // Line 0: # typed: strict
      // Line 1: # frozen_string_literal: true
      // Line 2: # pack_public: true  <- replaced old blank
      // Line 3: (blank)               <- we add a blank after
      // Line 4: module Cryptography

      expect(newLines).to.deep.equal([
        '# typed: strict',
        '# frozen_string_literal: true',
        '# pack_public: true',
        '',
        'module Cryptography',
        '  module AegisJwt',
      ]);
    });

    it('FAILING TEST - reproduces the actual bug', () => {
      // Original file
      const originalFile = `# typed: strict
# frozen_string_literal: true

module Cryptography
  module AegisJwt`;

      const lines = originalFile.split('\n');
      // 0: "# typed: strict"
      // 1: "# frozen_string_literal: true"
      // 2: ""  <-- BLANK LINE
      // 3: "module Cryptography"
      // 4: "  module AegisJwt"

      const insertLine = findSigilInsertionLine(lines);
      expect(insertLine).to.equal(2); // Returns line 2 (the blank)

      // Simulate VSCode replace: range (2,0) to (3,0) with "# pack_public: true\n\n"
      // This means: replace from start of line 2 to start of line 3
      const linesArray = lines.slice();

      // Remove line at index 2 (the blank line)
      linesArray.splice(insertLine, 1);
      // Insert new content at index 2
      linesArray.splice(insertLine, 0, '# pack_public: true', '');

      const result = linesArray.join('\n');

      // What we ACTUALLY want:
      const expected = `# typed: strict
# frozen_string_literal: true
# pack_public: true

module Cryptography
  module AegisJwt`;

      // What we're GETTING (the bug):
      const buggyResult = `# typed: strict
# frozen_string_literal: true

# pack_public: true

module Cryptography
  module AegisJwt`;

      // This test should PASS when bug is fixed
      expect(result).to.equal(expected);
      expect(result).to.not.equal(buggyResult);
    });

    it('handles file with only typed header', () => {
      const lines = [
        '# typed: strict',
        '',
        'module Foo',
      ];

      const result = findSigilInsertionLine(lines);
      expect(result).to.equal(1);
    });

    it('handles file with no headers', () => {
      const lines = [
        'module Foo',
        '  class Bar',
      ];

      const result = findSigilInsertionLine(lines);
      expect(result).to.equal(0);
    });

    it('handles file with headers but no blank line', () => {
      const lines = [
        '# typed: strict',
        '# frozen_string_literal: true',
        'module Cryptography',
      ];

      const result = findSigilInsertionLine(lines);
      expect(result).to.equal(2);
    });

    it('handles file with other comments after headers', () => {
      const lines = [
        '# typed: strict',
        '# frozen_string_literal: true',
        '# This is a comment',
        '',
        'module Foo',
      ];

      const result = findSigilInsertionLine(lines);
      expect(result).to.equal(2);
    });
  });
});
