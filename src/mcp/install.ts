import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { log } from '../infra/logger.js';

export type ClientName = 'cursor' | 'claude' | 'codex' | 'opencode';

export interface InstallOptions {
  client: ClientName | 'all';
  cwd: string;
  binPath: string;
  args: string[];
  dryRun?: boolean;
  uninstall?: boolean;
}

export interface InstallResult {
  client: ClientName;
  path: string;
  written: boolean;
  existed: boolean;
  message: string;
}

function cursorConfigPath(cwd: string): string {
  return join(cwd, '.cursor', 'mcp.json');
}

function claudeConfigPath(): string {
  return join(homedir(), '.claude', 'mcp.json');
}

function codexConfigPath(): string {
  return join(homedir(), '.codex', 'config.toml');
}

function opencodeConfigPath(cwd: string): string {
  return join(cwd, 'opencode.json');
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function installCursor(opts: InstallOptions): InstallResult {
  const path = cursorConfigPath(opts.cwd);
  const existed = existsSync(path);
  if (opts.uninstall) {
    const cfg = readJson<{ mcpServers?: Record<string, unknown> }>(path, {});
    if (cfg.mcpServers?.['aion']) {
      delete cfg.mcpServers['aion'];
      if (!opts.dryRun) writeFile(path, JSON.stringify(cfg, null, 2));
      return { client: 'cursor', path, written: !opts.dryRun, existed, message: 'removed aion from .cursor/mcp.json' };
    }
    return { client: 'cursor', path, written: false, existed, message: 'aion not present in .cursor/mcp.json' };
  }
  const cfg = readJson<{ mcpServers?: Record<string, unknown> }>(path, {});
  cfg.mcpServers = cfg.mcpServers ?? {};
  cfg.mcpServers['aion'] = { command: opts.binPath, args: opts.args };
  if (!opts.dryRun) writeFile(path, JSON.stringify(cfg, null, 2));
  return { client: 'cursor', path, written: !opts.dryRun, existed, message: `cursor config at ${path}` };
}

export function installClaude(opts: InstallOptions): InstallResult {
  const path = claudeConfigPath();
  const existed = existsSync(path);
  if (opts.uninstall) {
    const cfg = readJson<{ mcpServers?: Record<string, unknown> }>(path, {});
    if (cfg.mcpServers?.['aion']) {
      delete cfg.mcpServers['aion'];
      if (!opts.dryRun) writeFile(path, JSON.stringify(cfg, null, 2));
      return { client: 'claude', path, written: !opts.dryRun, existed, message: 'removed aion from claude config' };
    }
    return { client: 'claude', path, written: false, existed, message: 'aion not present in claude config' };
  }
  const cfg = readJson<{ mcpServers?: Record<string, unknown> }>(path, {});
  cfg.mcpServers = cfg.mcpServers ?? {};
  cfg.mcpServers['aion'] = { command: opts.binPath, args: opts.args };
  if (!opts.dryRun) writeFile(path, JSON.stringify(cfg, null, 2));
  return { client: 'claude', path, written: !opts.dryRun, existed, message: `claude config at ${path}` };
}

export function installCodex(opts: InstallOptions): InstallResult {
  const path = codexConfigPath();
  const existed = existsSync(path);
  const argsToml = opts.args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(', ');
  const block = `[mcp_servers.aion]\ncommand = "${opts.binPath.replace(/"/g, '\\"')}"\nargs = [${argsToml}]\n`;
  let content = '';
  if (existed) content = readFileSync(path, 'utf8');
  const lines = content.split('\n');
  const startIdx = lines.findIndex((l) => l.startsWith('[mcp_servers.aion]'));
  if (opts.uninstall) {
    if (startIdx === -1) return { client: 'codex', path, written: false, existed, message: 'aion not present in codex config' };
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (lines[i]?.startsWith('[')) { endIdx = i; break; }
    }
    lines.splice(startIdx, endIdx - startIdx);
    if (!opts.dryRun) writeFile(path, lines.join('\n'));
    return { client: 'codex', path, written: !opts.dryRun, existed, message: 'removed aion from codex config' };
  }
  if (startIdx !== -1) {
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (lines[i]?.startsWith('[')) { endIdx = i; break; }
    }
    lines.splice(startIdx, endIdx - startIdx);
  }
  lines.push(block);
  if (!opts.dryRun) writeFile(path, lines.join('\n'));
  return { client: 'codex', path, written: !opts.dryRun, existed, message: `codex config at ${path}` };
}

export function installOpencode(opts: InstallOptions): InstallResult {
  const path = opencodeConfigPath(opts.cwd);
  const existed = existsSync(path);
  if (opts.uninstall) {
    const cfg = readJson<{ mcp?: Record<string, unknown> }>(path, {});
    if (cfg.mcp?.['aion']) {
      delete cfg.mcp['aion'];
      if (!opts.dryRun) writeFile(path, JSON.stringify(cfg, null, 2));
      return { client: 'opencode', path, written: !opts.dryRun, existed, message: 'removed aion from opencode config' };
    }
    return { client: 'opencode', path, written: false, existed, message: 'aion not present in opencode config' };
  }
  const cfg = readJson<{ mcp?: Record<string, unknown> }>(path, {});
  cfg.mcp = cfg.mcp ?? {};
  cfg.mcp['aion'] = { type: 'local', command: [opts.binPath, ...opts.args] };
  if (!opts.dryRun) writeFile(path, JSON.stringify(cfg, null, 2));
  return { client: 'opencode', path, written: !opts.dryRun, existed, message: `opencode config at ${path}` };
}

export function installClient(opts: InstallOptions): InstallResult[] {
  const scopedLog = log.child('mcp.install');
  const clients: ClientName[] = opts.client === 'all' ? ['cursor', 'claude', 'codex', 'opencode'] : [opts.client];
  const results: InstallResult[] = [];
  for (const client of clients) {
    try {
      let r: InstallResult;
      switch (client) {
        case 'cursor': r = installCursor(opts); break;
        case 'claude': r = installClaude(opts); break;
        case 'codex': r = installCodex(opts); break;
        case 'opencode': r = installOpencode(opts); break;
      }
      scopedLog.info('client install', { client, written: r.written, message: r.message });
      results.push(r);
    } catch (err) {
      scopedLog.error('client install failed', { client, error: String(err) });
      results.push({ client, path: '?', written: false, existed: false, message: `error: ${String(err)}` });
    }
  }
  return results;
}

export interface DoctorCheck {
  client: ClientName;
  status: 'ok' | 'missing' | 'broken';
  path: string;
  detail: string;
}

export function doctorCheck(cwd: string, client?: ClientName): DoctorCheck[] {
  const clients: ClientName[] = client ? [client] : ['cursor', 'claude', 'codex', 'opencode'];
  return clients.map((c) => {
    const path = c === 'cursor' ? cursorConfigPath(cwd) : c === 'claude' ? claudeConfigPath() : c === 'codex' ? codexConfigPath() : opencodeConfigPath(cwd);
    if (!existsSync(path)) return { client: c, status: 'missing' as const, path, detail: 'config file does not exist' };
    try {
      const content = readFileSync(path, 'utf8');
      const has = c === 'codex' ? content.includes('[mcp_servers.aion]') : ((): boolean => {
        try {
          const obj = JSON.parse(content) as { mcpServers?: Record<string, unknown>; mcp?: Record<string, unknown> };
          return c === 'cursor' ? !!obj.mcpServers?.['aion'] : c === 'claude' ? !!obj.mcpServers?.['aion'] : !!obj.mcp?.['aion'];
        } catch { return false; }
      })();
      if (!has) return { client: c, status: 'broken' as const, path, detail: 'aion entry missing' };
      return { client: c, status: 'ok' as const, path, detail: 'aion registered' };
    } catch (err) {
      return { client: c, status: 'broken' as const, path, detail: `cannot read: ${String(err)}` };
    }
  });
}

export function defaultBinPath(): string {
  return process.argv[1] ?? 'aion';
}

export function defaultServerArgs(): string[] {
  return ['mcp', 'serve'];
}
