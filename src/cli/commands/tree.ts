import type { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { GraphAgent } from '../../agents/graph-agent.js';
import type { AuditFinding } from '../../schemas/audit.js';
import { latestAuditPointer } from '../../infra/project-report.js';

interface Node {
  name: string;
  path: string;
  files: number;
  loc: number;
  findings: number;
  children: Map<string, Node>;
}

function newNode(name: string, path: string): Node {
  return { name, path, files: 0, loc: 0, findings: 0, children: new Map() };
}

function latestFindings(cwd: string): AuditFinding[] {
  try {
    const pointer = latestAuditPointer(cwd);
    const reportPath = pointer?.runDir ? join(pointer.runDir, 'report.json') : pointer?.report;
    if (!reportPath || !existsSync(reportPath)) return [];
    return (JSON.parse(readFileSync(reportPath, 'utf8')) as { findings?: AuditFinding[] }).findings ?? [];
  } catch {
    return [];
  }
}

function addPath(root: Node, file: string, loc: number, findings: number): void {
  const parts = file.split('/');
  let node = root;
  node.files++;
  node.loc += loc;
  node.findings += findings;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const path = parts.slice(0, i + 1).join('/');
    let child = node.children.get(part);
    if (!child) {
      child = newNode(part, path);
      node.children.set(part, child);
    }
    child.files++;
    child.loc += loc;
    child.findings += findings;
    node = child;
  }
}

function render(node: Node, depth: number, maxDepth: number, hotspots: boolean, prefix = ''): string[] {
  if (depth >= maxDepth) return [];
  const children = [...node.children.values()]
    .sort((a, b) => hotspots ? b.findings - a.findings || b.loc - a.loc : a.name.localeCompare(b.name));
  const lines: string[] = [];
  children.forEach((child, index) => {
    const last = index === children.length - 1;
    const branch = last ? '└─ ' : '├─ ';
    const nextPrefix = prefix + (last ? '   ' : '│  ');
    const marker = child.children.size > 0 ? '/' : '';
    const risk = child.findings > 0 ? chalk.red(` findings:${child.findings}`) : chalk.gray(' findings:0');
    lines.push(`${prefix}${branch}${chalk.bold(child.name)}${marker} ${chalk.gray(`files:${child.files} loc:${child.loc}`)}${risk}`);
    lines.push(...render(child, depth + 1, maxDepth, hotspots, nextPrefix));
  });
  return lines;
}

export function registerTree(program: Command): void {
  program
    .command('tree')
    .description('Show repository tree with file, LOC, and latest audit finding counts')
    .option('--depth <n>', 'max tree depth', '4')
    .option('--hotspots', 'sort folders/files by latest finding count')
    .option('--rebuild', 'rebuild the repository index before rendering')
    .action(async (options: { depth: string; hotspots?: boolean; rebuild?: boolean }) => {
      const cwd = process.cwd();
      const graph = new GraphAgent(cwd);
      const index = options.rebuild ? await graph.buildIndex() : await graph.ensureIndex();
      const findings = latestFindings(cwd);
      const byFile = findings.reduce<Record<string, number>>((acc, finding) => {
        acc[finding.file] = (acc[finding.file] ?? 0) + 1;
        return acc;
      }, {});
      const root = newNode('.', '.');
      for (const file of index.files) addPath(root, file.path, file.loc, byFile[file.path] ?? 0);
      const maxDepth = Math.max(1, Math.min(12, parseInt(options.depth, 10) || 4));
      console.log(chalk.bold.cyan('\nProject Tree\n'));
      console.log(chalk.gray(`files:${root.files} loc:${root.loc} findings:${root.findings}`));
      render(root, 0, maxDepth, Boolean(options.hotspots)).forEach((line) => console.log(line));
    });
}
