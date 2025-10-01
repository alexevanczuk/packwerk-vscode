/**
 * Finds the line number where pack_public sigil should be inserted
 * after file headers like # typed: and # frozen_string_literal:
 */
export function findSigilInsertionLine(lines: string[]): number {
  let insertLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip typed, frozen_string_literal headers
    if (line.startsWith('# typed:') ||
        line.startsWith('# frozen_string_literal:')) {
      insertLine = i + 1;
    } else if (insertLine > 0) {
      // We've passed headers, stop here
      break;
    }
  }

  return insertLine;
}
