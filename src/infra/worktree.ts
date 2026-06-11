import { spawnSync } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';
import { WORKTREES_DIR } from './paths.js';

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

  return worktreePath;
}

export function removeWorktree(cwd: string, agentName: string, taskId: string): void {
  const shortId = taskId.slice(0, 8);
  const name = `${agentName}-${shortId}`;
  const worktreePath = join(cwd, WORKTREES_DIR, name);

  if (!existsSync(worktreePath)) return;

  assertGit(cwd, ['worktree', 'remove', '--force', worktreePath]);
  assertGit(cwd, ['branch', '-D', `ai/${name}`]);
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
