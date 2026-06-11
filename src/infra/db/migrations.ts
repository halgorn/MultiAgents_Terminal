import { mkdirSync } from 'fs';
import { join } from 'path';
import { STORE_DIR } from './store.js';

export function runMigrations(): void {
  for (const dir of ['tasks', 'evidence', 'history']) {
    mkdirSync(join(STORE_DIR, dir), { recursive: true });
  }
}
