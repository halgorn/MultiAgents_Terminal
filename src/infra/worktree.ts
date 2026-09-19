import { spawnSync } from 'child_process';
import { join } from 'path';
import { existsSync, rmSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { WORKTREES_DIR } from './paths.js';
import { readPolicy, matchesDenyList } from './policy.js';

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
}

function git(cwd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function assertGit(cwd: string, args: string[]): string {
  const result = git(cwd, args);
  if (!result.ok) {
    const details = result.stderr.trim() || result.stdout.trim() || 'unknown git error';
    throw new Error(`git ${args.join(' ')} failed: ${details}`);
  }
  return result.stdout;
}

export function createWorktree(cwd: string, agentName: string, taskId: string): string {
  const shortId = taskId.slice(0, 8);
  const name = `${agentName}-${shortId}`;
  const worktreePath = join(cwd, WORKTREES_DIR, name);
  const branch = `ai/${name}`;

  if (existsSync(worktreePath)) return worktreePath;

  assertGit(cwd, ['rev-parse', '--verify', 'HEAD']);
  assertGit(cwd, ['worktree', 'add', worktreePath, '-b', branch, 'HEAD']);
  stripDeniedFiles(cwd, worktreePath);

  return worktreePath;
}

// Agents get raw Read/Bash access inside the worktree; strip files the policy
// deny-lists (secrets, keys) so they're never exposed to an agent process.
function stripDeniedFiles(cwd: string, worktreePath: string): void {
  const policy = readPolicy(cwd);
  if (!policy.denyList.length) return;
  const { stdout } = git(worktreePath, ['ls-files']);
  for (const rel of stdout.split('\n').filter(Boolean)) {
    if (matchesDenyList(rel, policy.denyList)) {
      try { rmSync(join(worktreePath, rel), { force: true }); } catch { /* best-effort */ }
    }
  }
}

// Applies a developer agent's captured diff to the real working tree. Diffs
// are relative to the repo root, so they apply cleanly from any worktree of
// the same repo (git worktrees share one object store).
export function applyDiffToRepo(cwd: string, diff: string): { ok: boolean; error?: string } {
  const patchFile = join(tmpdir(), `aion-patch-${randomUUID()}.diff`);
  writeFileSync(patchFile, diff, 'utf8');
  try {
    const result = git(cwd, ['apply', '--whitespace=nowarn', patchFile]);
    if (!result.ok) {
      return { ok: false, error: (result.stderr.trim() || result.stdout.trim() || 'git apply failed') };
    }
    return { ok: true };
  } finally {
    try { unlinkSync(patchFile); } catch { /* best-effort */ }
  }
}

export function removeWorktree(cwd: string, agentName: string, taskId: string): void {
  const shortId = taskId.slice(0, 8);
  const name = `${agentName}-${shortId}`;
  const worktreePath = join(cwd, WORKTREES_DIR, name);

  if (!existsSync(worktreePath)) return;

  try {
    assertGit(cwd, ['worktree', 'remove', '--force', worktreePath]);
  } catch { /* worktree may not be registered; proceed to directory cleanup */ }
  git(cwd, ['branch', '-D', `ai/${name}`]); // best-effort; branch may already be gone
  // git worktree remove leaves behind app-written files (e.g. .claude/CLAUDE.md)
  if (existsSync(worktreePath)) rmSync(worktreePath, { recursive: true, force: true });
}

export function listWorktrees(cwd: string): WorktreeInfo[] {
  const { ok, stdout } = git(cwd, ['worktree', 'list', '--porcelain']);
  if (!ok) return [];

  const entries = stdout.trim().split('\n\n');
  return entries
    .filter(Boolean)
    .map((entry) => {
      const lines = entry.split('\n');
      const path = lines[0]?.replace('worktree ', '') ?? '';
      const head = lines[1]?.replace('HEAD ', '') ?? '';
      const branch = lines[2]?.replace('branch refs/heads/', '') ?? '';
      return { path, head, branch };
    });
}
