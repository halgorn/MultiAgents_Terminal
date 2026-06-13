import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { AION_GITIGNORE_ENTRIES } from './paths.js';

const AION_BLOCK_START = '# aion generated files';
const AION_BLOCK_END = '# end aion';

export function ensureGitignore(cwd: string): { added: string[]; skipped: string[] } {
  const gitignorePath = join(cwd, '.gitignore');

  const existing = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, 'utf8')
    : '';

  const lines = new Set(
    existing.split('\n').map((l) => l.trim()).filter(Boolean),
  );

  const missing = AION_GITIGNORE_ENTRIES.filter((entry) => !lines.has(entry));

  if (missing.length === 0) {
    return { added: [], skipped: AION_GITIGNORE_ENTRIES };
  }

  // Check if an aion block already exists → append inside it or after it
  const hasBlock = existing.includes(AION_BLOCK_START);

  let updated: string;
  if (hasBlock) {
    // Insert missing entries before the closing marker
    updated = existing.replace(
      AION_BLOCK_END,
      missing.join('\n') + '\n' + AION_BLOCK_END,
    );
  } else {
    // Append a new aion block at the end
    const tail = existing.endsWith('\n') ? '' : '\n';
    updated =
      existing +
      tail +
      '\n' + AION_BLOCK_START + '\n' +
      missing.join('\n') + '\n' +
      AION_BLOCK_END + '\n';
  }

  writeFileSync(gitignorePath, updated, 'utf8');
  return { added: missing, skipped: AION_GITIGNORE_ENTRIES.filter((e) => !missing.includes(e)) };
}
