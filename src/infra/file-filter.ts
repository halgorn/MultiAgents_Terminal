import { WORKTREES_DIR } from './paths.js';

export const SOURCE_EXTS = [
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java', '.rb', '.rs', '.swift', '.kt', '.cs', '.cpp', '.c', '.h',
];

export const IGNORE_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', WORKTREES_DIR, 'coverage',
  '.next', '__pycache__', 'vendor', 'target', '.gradle', 'Pods',
  '.cache', 'tmp', 'temp', 'logs', 'fixtures', 'testdata',
  '.venv', 'venv', 'env', 'out', '.output', '.turbo', '.parcel-cache',
  '.svelte-kit', '.nuxt', '.vite', '.vercel', '.netlify',
  'storybook-static', 'public/build', 'release',
]);

export const GENERATED_FILE_PATTERNS = [
  /\.min\.[cm]?[jt]sx?$/i,
  /\.bundle\.[cm]?[jt]sx?$/i,
  /\.chunk\.[cm]?[jt]sx?$/i,
  /\.d\.ts$/i,
  /\.map$/i,
  /\.generated\./i,
  /\.g\.(?:ts|js|go|cs)$/i,
  /\.pb\.(?:ts|js|go|py)$/i,
  /(^|[/\\])generated([/\\]|$)/i,
  /(^|[/\\])__generated__([/\\]|$)/i,
  /(^|[/\\])gen([/\\]|$)/i,
  /(^|[/\\])vendor([/\\]|$)/i,
];

export function isIgnoredDirName(name: string): boolean {
  return IGNORE_DIRS.has(name) || name.startsWith('.');
}

export function isGeneratedArtifact(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  return GENERATED_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}
