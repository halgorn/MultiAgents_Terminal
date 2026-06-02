import { createInterface } from 'readline';
import chalk from 'chalk';
import { classify } from './classifier.js';
import { Orchestrator } from '../core/orchestrator.js';
import { Renderer } from './ui/renderer.js';
import { KnowledgeStore } from '../infra/knowledge.js';

export async function runNaturalLanguage(input: string, cwd: string): Promise<void> {
  const { intent, target } = classify(input);

  if (intent === 'unknown') {
    // Default to analyze when intent is unclear
    console.log(chalk.gray(`→ analyzing: "${target}"`));
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

  let result;
  if (intent === 'fix') result = await orch.runFixPipeline(target);
  else if (intent === 'review') result = await orch.runReviewPipeline(target);
  else result = await orch.runAnalyzePipeline(target);

  renderer.showResult(result);
}

export async function runInteractive(cwd: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log(chalk.bold('\n🤖 AI Engineering Runtime'));
  console.log(chalk.gray('Type your request in natural language. Ctrl+C to exit.\n'));
  console.log(chalk.gray('Examples:'));
  console.log(chalk.gray('  corrija o bug de autenticação'));
  console.log(chalk.gray('  analise os erros no módulo de pagamento'));
  console.log(chalk.gray('  revise o arquivo src/auth/middleware.ts'));
  console.log(chalk.gray('  indexar memória\n'));

  const prompt = (): Promise<void> => new Promise((resolve) => {
    rl.question(chalk.bold.cyan('ai> '), async (input) => {
      const trimmed = input.trim();
      if (!trimmed || trimmed === 'exit' || trimmed === 'quit') {
        rl.close();
        resolve();
        return;
      }

      try {
        await runNaturalLanguage(trimmed, cwd);
      } catch (err) {
        console.error(chalk.red('Error: ' + String(err)));
      }

      console.log();
      resolve(prompt());
    });
  });

  await prompt();
}
