import { createInterface } from 'readline';
import chalk from 'chalk';
import { classify } from './classifier.js';
import { Orchestrator } from '../core/orchestrator.js';
import { Renderer } from './ui/renderer.js';
import { KnowledgeStore } from '../infra/knowledge.js';
import { GraphAgent } from '../agents/graph-agent.js';
import { displayProjectName } from '../infra/project-name.js';

const HELP_LINES = [
  chalk.bold('Commands:'),
  `  ${chalk.cyan('fix <description>')}     — run fix pipeline`,
  `  ${chalk.cyan('review <file/topic>')}   — review code or topic`,
  `  ${chalk.cyan('audit')}                 — run security/quality audit`,
  `  ${chalk.cyan('memory build')}          — build embedding index`,
  `  ${chalk.cyan('memory search <query>')} — semantic memory search`,
  `  ${chalk.cyan('graph')}                 — index repository symbol graph`,
  '',
  chalk.dim('  /help or ?  show this message'),
  chalk.dim('  clear       clear screen'),
  chalk.dim('  exit        leave REPL'),
];

function printHelp(): void {
  console.log('');
  for (const line of HELP_LINES) console.log(line);
  console.log('');
}

export async function runNaturalLanguage(input: string, cwd: string): Promise<void> {
  const { intent, target } = classify(input);

  if (intent === 'unknown') {
    console.log(chalk.yellow('  ⚠ Intent unclear, falling back to general analysis...'));
    await runWithRenderer(cwd, 'analyze', target);
    return;
  }

  if (intent === 'memory-build') {
    console.log(chalk.gray('→ ai memory build'));
    const store = new KnowledgeStore(cwd);
    const { default: ora } = await import('ora');
    const spinner = ora('Building embedding index...').start();
    const count = await store.embeddings.buildIndex(['architecture', 'bugs', 'features', 'decisions', 'patterns']);
    spinner.succeed(chalk.green(`Indexed ${count} entries`));
    return;
  }

  if (intent === 'memory-search') {
    console.log(chalk.gray(`→ ai memory search "${target}"`));
    const store = new KnowledgeStore(cwd);
    const results = await store.embeddings.query(target, 5);
    for (const r of results) {
      console.log(`${chalk.cyan((r.score * 100).toFixed(1) + '%')}  ${chalk.bold(r.category + '/' + r.filename)}`);
      console.log(chalk.gray('  ' + r.text.split('\n')[0]?.slice(0, 100)));
    }
    return;
  }

  if (intent === 'graph-index') {
    console.log(chalk.gray('→ building repository graph index...'));
    const graph = new GraphAgent(cwd);
    const { default: ora } = await import('ora');
    const spinner = ora('Indexing repository...').start();
    const index = await graph.buildIndex();
    spinner.succeed(chalk.green(`Indexed ${index.stats.files} files, ${index.stats.symbols} symbols, ${index.stats.chunks} chunks`));
    if (index.stats.testLinks > 0) console.log(chalk.gray(`  ${index.stats.testLinks} test links mapped`));
    return;
  }

  if (intent === 'audit') {
    console.log(chalk.gray(`→ ai audit`));
    const orch = new Orchestrator(cwd);
    const renderer = new Renderer();
    orch.on('agent:start', ({ agentName }) => renderer.agentStart(agentName));
    orch.on('agent:output', ({ agentName, text }) => renderer.agentChunk(agentName, text));
    orch.on('agent:done', ({ agentName, durationMs }) => renderer.agentDone(agentName, durationMs));
    const start = Date.now();
    const report = await orch.runAuditPipeline(target, 5);
    console.log(chalk.bold.cyan(`\nAudit complete in ${((Date.now()-start)/1000).toFixed(1)}s — ${report.findings.length} findings across ${report.totalFiles} files`));
    console.log(report.summary);
    report.topPriorities.forEach((p, i) => console.log(chalk.cyan(`  ${i+1}.`) + ' ' + p));
    return;
  }

  const cmdLabel = intent === 'fix' ? 'fix' : intent === 'review' ? 'review' : 'analyze';
  console.log(chalk.gray(`→ ai ${cmdLabel} "${target}"`));
  await runWithRenderer(cwd, intent as 'fix' | 'analyze' | 'review', target);
}

async function runWithRenderer(
  cwd: string,
  intent: 'fix' | 'analyze' | 'review',
  target: string,
): Promise<void> {
  const renderer = new Renderer();
  const orch = new Orchestrator(cwd);

  orch.on('state:change', ({ state }) => renderer.showState(state));
  orch.on('agent:start', ({ agentName }) => renderer.agentStart(agentName));
  orch.on('agent:output', ({ agentName, text }) => renderer.agentChunk(agentName, text));
  orch.on('agent:done', ({ agentName, durationMs }) => renderer.agentDone(agentName, durationMs));
  orch.on('error', ({ message }) => renderer.showError(message));

  try {
    let result;
    if (intent === 'fix') result = await orch.runFixPipeline(target);
    else if (intent === 'review') result = await orch.runReviewPipeline(target);
    else result = await orch.runAnalyzePipeline(target);
    renderer.showResult(result);
  } finally {
    orch.removeAllListeners();
  }
}

export async function runInteractive(cwd: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  // Ctrl+C inside readline emits SIGINT on rl; close gracefully so the
  // menu process survives instead of dying with an unhandled SIGINT.
  rl.on('SIGINT', () => { process.stdout.write('\n'); rl.close(); });

  const project = displayProjectName(cwd);
  console.log(chalk.bold(`\n🤖 AI Runtime`) + chalk.dim(` — ${project}`));
  console.log(chalk.gray('Natural language interface. Type /help or ? for commands.\n'));

  const promptLabel = chalk.bold.cyan(`ai[${project}]> `);

  const prompt = (): Promise<void> => new Promise((resolve) => {
    rl.question(promptLabel, async (input) => {
      const trimmed = input.trim();

      if (!trimmed || trimmed === 'exit' || trimmed === 'quit') {
        rl.close();
        resolve();
        return;
      }

      if (trimmed === '/help' || trimmed === '?') {
        printHelp();
        resolve(prompt());
        return;
      }

      if (trimmed === 'clear') {
        process.stdout.write('\x1Bc');
        resolve(prompt());
        return;
      }

      try {
        await runNaturalLanguage(trimmed, cwd);
      } catch (err) {
        process.stderr.write(chalk.red('\n  ✗ Error: ') + chalk.red(err instanceof Error ? err.message : String(err)) + '\n');
      }

      console.log();
      resolve(prompt());
    });
  });

  await prompt();
}
