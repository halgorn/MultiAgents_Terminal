import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export interface PackageGuardFile {
  path: string;
  size: number;
}

export interface PackageGuardReport {
  ok: boolean;
  packageSizeKb: number;
  unpackedSizeKb: number;
  fileCount: number;
  files: PackageGuardFile[];
  problems: string[];
}

const REQUIRED_FILES = ['dist/index.js', 'package.json', 'README.md'];
const FORBIDDEN_PREFIXES = ['src/', '.ai-runtime/', '.git/', 'node_modules/', 'dist/test-utils/'];

function kb(bytes: number): number {
  return Math.round((bytes / 1024) * 10) / 10;
}

export function runPackageGuard(cwd: string, maxPackageKb = 750): PackageGuardReport {
  const cache = join(tmpdir(), 'aion-npm-cache');
  const packDir = mkdtempSync(join(tmpdir(), 'aion-pack-guard-'));
  mkdirSync(cache, { recursive: true });
  const result = spawnSync('npm', ['pack', '--pack-destination', packDir, '--ignore-scripts'], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: cache },
    timeout: 60_000,
    maxBuffer: 5 * 1024 * 1024,
  });
  const cleanup = () => rmSync(packDir, { recursive: true, force: true });
  if (result.status !== 0) {
    const problem = `npm pack failed: ${(result.stderr || result.stdout || 'unknown error').trim()}`;
    cleanup();
    return { ok: false, packageSizeKb: 0, unpackedSizeKb: 0, fileCount: 0, files: [], problems: [problem] };
  }

  const tarball = readdirSync(packDir).find((file) => file.endsWith('.tgz'));
  if (!tarball) {
    cleanup();
    return { ok: false, packageSizeKb: 0, unpackedSizeKb: 0, fileCount: 0, files: [], problems: ['npm pack did not create a tarball'] };
  }
  const tarPath = join(packDir, tarball);
  const listing = spawnSync('tar', ['-tvzf', tarPath], { encoding: 'utf8', timeout: 30_000, maxBuffer: 5 * 1024 * 1024 });
  if (listing.status !== 0) {
    cleanup();
    return { ok: false, packageSizeKb: 0, unpackedSizeKb: 0, fileCount: 0, files: [], problems: ['tarball listing failed'] };
  }

  const files = listing.stdout.split('\n').flatMap((line) => {
    const match = /^\S+\s+\S+\/\S+\s+(\d+)\s+\S+\s+\S+\s+package\/(.+)$/.exec(line.trim());
    if (!match) return [];
    return [{ path: match[2]!, size: Number(match[1]) || 0 }];
  });
  const names = new Set(files.map((file) => file.path));
  const problems: string[] = [];
  const packageSizeKb = kb(statSync(tarPath).size);
  const unpackedSizeKb = kb(files.reduce((sum, file) => sum + file.size, 0));
  cleanup();

  for (const required of REQUIRED_FILES) {
    if (!names.has(required)) problems.push(`missing required package file: ${required}`);
  }
  for (const file of files) {
    if (FORBIDDEN_PREFIXES.some((prefix) => file.path.startsWith(prefix))) {
      problems.push(`unexpected package file: ${file.path}`);
    }
    if (file.path.endsWith('.map')) problems.push(`unexpected sourcemap in package: ${file.path}`);
  }
  if (packageSizeKb > maxPackageKb) problems.push(`package size ${packageSizeKb} KB exceeds ${maxPackageKb} KB`);

  return { ok: problems.length === 0, packageSizeKb, unpackedSizeKb, fileCount: files.length, files, problems };
}
