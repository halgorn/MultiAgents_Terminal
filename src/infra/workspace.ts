import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { basename, dirname, join, relative, resolve } from 'path';
import { isIgnoredDirName } from './file-filter.js';

export interface WorkspaceConfig {
  name: string;
  root: string;
  repos: WorkspaceRepo[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceRepo {
  name: string;
  path: string;
  language?: string;
  description?: string;
}

export const WORKSPACE_FILE = 'workspace.json';

export function workspacePath(root: string): string {
  return join(root, WORKSPACE_FILE);
}

export function detectRepos(root: string, maxDepth = 2): WorkspaceRepo[] {
  const repos: WorkspaceRepo[] = [];
  const seen = new Set<string>();

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (isIgnoredDirName(entry)) continue;
      const full = join(dir, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (!st.isDirectory()) continue;
      const indicators = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'Gemfile'];
      for (const ind of indicators) {
        if (existsSync(join(full, ind))) {
          const rel = relative(root, full);
          if (!seen.has(rel)) {
            seen.add(rel);
            repos.push({ name: entry, path: rel });
          }
          break;
        }
      }
      if (depth < maxDepth) walk(full, depth + 1);
    }
  }

  walk(root, 0);
  return repos.sort((a, b) => a.name.localeCompare(b.name));
}

export function readWorkspaceConfig(root: string): WorkspaceConfig | null {
  const path = workspacePath(root);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as WorkspaceConfig;
    if (parsed.name && parsed.root && Array.isArray(parsed.repos)) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function writeWorkspaceConfig(root: string, config: WorkspaceConfig): string {
  const path = workspacePath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf8');
  return path;
}

export function initWorkspace(root: string, name?: string, autoDetect = true): WorkspaceConfig {
  const repos = autoDetect ? detectRepos(root) : [];
  const now = new Date().toISOString();
  const config: WorkspaceConfig = {
    name: name ?? deriveName(root),
    root,
    repos,
    createdAt: now,
    updatedAt: now,
  };
  writeWorkspaceConfig(root, config);
  return config;
}

export function addRepoToWorkspace(root: string, repo: WorkspaceRepo): WorkspaceConfig | null {
  const config = readWorkspaceConfig(root);
  if (!config) return null;
  if (config.repos.some((r) => r.path === repo.path)) return config;
  config.repos.push(repo);
  config.updatedAt = new Date().toISOString();
  writeWorkspaceConfig(root, config);
  return config;
}

export function removeRepoFromWorkspace(root: string, name: string): WorkspaceConfig | null {
  const config = readWorkspaceConfig(root);
  if (!config) return null;
  config.repos = config.repos.filter((r) => r.name !== name);
  config.updatedAt = new Date().toISOString();
  writeWorkspaceConfig(root, config);
  return config;
}

export function resolveRepoPath(workspaceRoot: string, repo: WorkspaceRepo): string {
  return resolve(workspaceRoot, repo.path);
}

export function deriveName(root: string): string {
  return basename(root) || 'workspace';
}
