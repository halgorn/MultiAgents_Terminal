import { mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const STORE_DIR = process.env['AI_RUNTIME_DB_PATH'] ?? join(homedir(), '.ai-runtime');

export function runMigrations(): void {
  for (const dir of ['tasks', 'evidence', 'history']) {
    mkdirSync(join(STORE_DIR, dir), { recursive: true });
  }
}
