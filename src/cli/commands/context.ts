import type { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { GraphAgent } from '../../agents/graph-agent.js';
import { renderAiContext, type FullSavedAuditReport } from '../../infra/audit-model.js';
import { queryRepoIndex } from '../../infra/repo-query.js';

function latestAudit(cwd: string): FullSavedAuditReport | null {
  try {
    const pointerPath = join(cwd, '.ai-runtime', 'reports', 'latest-audit.json');
    if (!existsSync(pointerPath)) return null;
    const pointer = JSON.parse(readFileSync(pointerPath, 'utf8')) as { runDir?: string; report?: string };
    const reportPath = pointer.runDir ? join(pointer.runDir, 'report.json') : pointer.report;
    if (!reportPath || !existsSync(reportPath)) return null;
    return JSON.parse(readFileSync(reportPath, 'utf8')) as FullSavedAuditReport;
  } catch {
    return null;
  }
}

function trimBudget(text: string, tokens: number): string {
  const maxChars = Math.max(2000, tokens * 4);
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n\n[truncated to ~${tokens} tokens]` : text;
}

async function buildTopicContext(cwd: string, topic: string, tokens: number): Promise<string> {
  const graph = new GraphAgent(cwd);
  const index = await graph.ensureIndex();
  const result = queryRepoIndex(index, topic, 12);
  const lines = [
    '# Aion Project Context',
    '',
    `Topic: ${topic}`,
    `Repository: ${index.stats.files} files, ${index.stats.symbols} symbols, ${index.stats.chunks} chunks`,
    '',
    '## Relevant Files',
    ...(result.files.length ? result.files.map((f) => `- ${f.path} (${f.loc} loc${f.isTest ? ', test' : ''})`) : ['No direct file matches.']),
    '',
    '## Relevant Symbols',
    ...(result.symbols.length ? result.symbols.map((s) => `- ${s.name} ${s.kind} ${s.file}:${s.line}`) : ['No direct symbol matches.']),
    '',
    '## Dependency Edges Near Matches',
    ...(result.imports.length ? result.imports.map((i) => `- ${i.from} -> ${i.resolved ?? i.specifier}`) : ['No nearby imports.']),
    '',
    '## Probable Tests',
    ...(result.tests.length ? result.tests.map((t) => `- ${t.source} <= ${t.tests.join(', ')}`) : ['No probable tests found.']),
    '',
  ];
  return trimBudget(lines.join('\n'), tokens);
}

export function registerContext(program: Command): void {
  program
    .command('context [topic...]')
    .description('Generate compact AI-safe context instead of sending raw reports or all files')
    .option('--budget <tokens>', 'approximate max output tokens', '8000')
    .option('--audit', 'use the latest audit as source')
    .option('--out <file>', 'output file path')
    .action(async (topicWords: string[], options: { budget: string; audit?: boolean; out?: string }) => {
      const cwd = process.cwd();
      const budget = Math.max(1000, Math.min(100000, parseInt(options.budget, 10) || 8000));
      const topic = topicWords.join(' ').trim() || 'project architecture audit hotspots';
      const audit = options.audit || topicWords.length === 0 ? latestAudit(cwd) : null;
      const text = audit ? renderAiContext(audit, budget) : await buildTopicContext(cwd, topic, budget);
      const out = options.out ?? join(cwd, '.ai-runtime', 'context', `${topic.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'project'}-context.md`);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, text, 'utf8');
      console.log(chalk.bold.cyan('\nContext generated'));
      console.log(chalk.gray(`file: ${out}`));
      console.log(chalk.gray(`size: ~${Math.round(text.length / 4)} tokens`));
    });
}
