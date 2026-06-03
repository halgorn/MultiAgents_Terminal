import type { Command } from 'commander';
import chalk from 'chalk';
import { ExplainAgent } from '../../agents/explain-agent.js';
import { GraphAgent } from '../../agents/graph-agent.js';
import { createRuntimePolicy } from '../../core/runtime-policy.js';
import { addRuntimeOptions, toRuntimePolicyInput, type RuntimeCliOptions } from '../runtime-options.js';

async function buildFileContext(cwd: string, filePath: string): Promise<string> {
  const graph = new GraphAgent(cwd);
  const index = graph.getIndex() ?? await graph.buildIndex();
  const fileEntry = index.files.find((f) => f.path === filePath || f.path.endsWith(filePath));
  if (!fileEntry) return `File: ${filePath}\n(not found in repo index)`;

  const symbols = index.symbols.filter((s) => s.file === fileEntry.path).slice(0, 15);
  const imports = index.imports.filter((i) => i.from === fileEntry.path).slice(0, 10);
  const importedBy = index.imports.filter((i) => i.resolved === fileEntry.path).slice(0, 15);
  const tests = index.tests.find((t) => t.source === fileEntry.path);

  const lines: string[] = [
    `File: ${fileEntry.path}`,
    `LOC: ${fileEntry.loc} | Test: ${fileEntry.isTest}`,
    symbols.length > 0 ? `\nExported symbols:\n${symbols.map((s) => `  ${s.kind} ${s.name} (line ${s.line})`).join('\n')}` : '',
    imports.length > 0 ? `\nImports:\n${imports.map((i) => `  ${i.specifier}`).join('\n')}` : '',
    importedBy.length > 0 ? `\nImported by (${importedBy.length} modules):\n${importedBy.slice(0, 8).map((i) => `  ${i.from}`).join('\n')}` : '',
    tests ? `\nTest files: ${tests.tests.join(', ')}` : '',
  ];

  return lines.filter(Boolean).join('\n');
}

async function buildOnboardContext(cwd: string): Promise<string> {
  const graph = new GraphAgent(cwd);
  const index = graph.getIndex() ?? await graph.buildIndex();

  let depInfo = '';
  try {
    const { detectLang } = await import('../../infra/lang-detect.js');
    const { buildDepGraph } = await import('../../infra/dep-graph.js');
    const { buildPythonDepGraph } = await import('../../infra/dep-graph-python.js');
    const { detectPatterns } = await import('../../infra/pattern-detect.js');
    const lang = detectLang(cwd);
    const dep = lang.lang === 'python' ? buildPythonDepGraph(cwd) : buildDepGraph(cwd);
    const patterns = detectPatterns(cwd, dep.hotspots);
    const hotspots = dep.hotspots.slice(0, 8);
    const cycles = dep.cycles.length;

    depInfo = [
      `\nHotspot files (highest coupling):\n${hotspots.map((h) => `  ${h.file} (fanIn:${h.fanIn} fanOut:${h.fanOut})`).join('\n')}`,
      cycles > 0 ? `\nCircular dependencies: ${cycles}` : '',
      `\nDetected patterns: ${patterns.detected.map((p) => p.pattern).join(', ')}`,
      patterns.antiPatterns.length > 0 ? `\nAnti-patterns: ${patterns.antiPatterns.map((a) => a.name).join(', ')}` : '',
    ].filter(Boolean).join('\n');
  } catch { /* best-effort */ }

  const topDirs = [...new Set(index.files.slice(0, 100).map((f) => f.path.split('/')[0]))].slice(0, 10);
  const testRatio = Math.round((index.files.filter((f) => f.isTest).length / Math.max(index.files.length, 1)) * 100);

  return [
    `Project: ${cwd.split('/').pop()}`,
    `Files: ${index.stats.files} | Symbols: ${index.stats.symbols} | Test ratio: ${testRatio}%`,
    `Top-level directories: ${topDirs.join(', ')}`,
    depInfo,
  ].join('\n');
}

async function buildImpactContext(cwd: string, filePath: string): Promise<string> {
  const fileCtx = await buildFileContext(cwd, filePath);
  const graph = new GraphAgent(cwd);
  const index = graph.getIndex() ?? await graph.buildIndex();

  // Transitive dependents (2 levels)
  const direct = index.imports.filter((i) => i.resolved?.endsWith(filePath) || i.resolved === filePath).map((i) => i.from);
  const transitive = new Set<string>();
  for (const dep of direct) {
    index.imports.filter((i) => i.resolved === dep || i.resolved?.endsWith(dep)).forEach((i) => transitive.add(i.from));
  }

  return [
    fileCtx,
    direct.length > 0 ? `\nDirect dependents (${direct.length}):\n${direct.slice(0, 10).map((f) => `  ${f}`).join('\n')}` : '\nNo direct dependents found.',
    transitive.size > 0 ? `\nTransitive dependents (${transitive.size}):\n${[...transitive].slice(0, 8).map((f) => `  ${f}`).join('\n')}` : '',
  ].join('\n');
}

export function registerExplain(program: Command): void {
  // explain <file>
  addRuntimeOptions(program
    .command('explain <file>')
    .description('AI explanation of a file: what it does, why it matters, how to refactor'))
    .action(async (file: string, options: RuntimeCliOptions) => {
      const cwd = process.cwd();
      const policy = createRuntimePolicy(toRuntimePolicyInput(options));
      console.log(chalk.bold.cyan(`\nExplaining ${file}…\n`));
      const context = await buildFileContext(cwd, file);
      const agent = new ExplainAgent('explain');
      const run = await agent.run({ worktreePath: cwd, mode: 'explain', target: file, context }, policy);
      console.log(run.output);
    });

  // impact <file>
  addRuntimeOptions(program
    .command('impact <file>')
    .description('Impact analysis: what breaks if you change this file'))
    .action(async (file: string, options: RuntimeCliOptions) => {
      const cwd = process.cwd();
      const policy = createRuntimePolicy(toRuntimePolicyInput(options));
      console.log(chalk.bold.cyan(`\nImpact analysis: ${file}…\n`));
      const context = await buildImpactContext(cwd, file);
      const agent = new ExplainAgent('impact');
      const run = await agent.run({ worktreePath: cwd, mode: 'impact', target: file, context }, policy);
      console.log(run.output);
    });

  // onboard
  addRuntimeOptions(program
    .command('onboard')
    .description('Generate developer onboarding guide for this project'))
    .action(async (options: RuntimeCliOptions) => {
      const cwd = process.cwd();
      const policy = createRuntimePolicy(toRuntimePolicyInput(options));
      const projectName = cwd.split('/').pop() ?? 'project';
      console.log(chalk.bold.cyan(`\nGenerating onboarding guide for ${projectName}…\n`));
      const context = await buildOnboardContext(cwd);
      const agent = new ExplainAgent('onboard');
      const run = await agent.run({ worktreePath: cwd, mode: 'onboard', target: projectName, context }, policy);
      console.log(run.output);
    });
}
