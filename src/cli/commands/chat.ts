import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as readline from 'readline';
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { GraphAgent } from '../../agents/graph-agent.js';
import { createRuntimePolicy, BUDGET_NAMES, PROVIDER_NAMES, type ProviderName, type BudgetName, type RuntimePolicy } from '../../core/runtime-policy.js';
import { displayProjectName } from '../../infra/project-name.js';
import { createProvider } from '../../providers/cli-provider.js';
import { AI_RUNTIME_DIR } from '../../infra/paths.js';

const SYSTEM_PROMPT = `You are an expert code assistant with deep knowledge of this repository.
Answer questions concisely based on the provided repository context.
When citing code locations use file:line format.
Never invent file paths or function names not shown in context.
If unsure, say so rather than guessing.`;

interface ChatEntry { role: 'user' | 'assistant'; content: string; ts: string; }

function historyPath(cwd: string): string {
  return join(cwd, AI_RUNTIME_DIR, 'chat-history.jsonl');
}

function loadHistory(cwd: string, limit = 20): ChatEntry[] {
  try {
    const p = historyPath(cwd);
    if (!existsSync(p)) return [];
    const lines = readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map((l) => JSON.parse(l) as ChatEntry);
  } catch { return []; }
}

function appendHistory(cwd: string, entry: ChatEntry): void {
  try {
    const p = historyPath(cwd);
    mkdirSync(join(cwd, AI_RUNTIME_DIR), { recursive: true });
    appendFileSync(p, JSON.stringify(entry) + '\n', 'utf8');
  } catch { /* best-effort */ }
}

async function askAI(
  cwd: string,
  question: string,
  context: string,
  provider: ProviderName,
  policy: RuntimePolicy,
  onChunk: (t: string) => void,
): Promise<void> {
  const systemPrompt = `${SYSTEM_PROMPT}\n\n--- REPOSITORY CONTEXT ---\n${context}\n--- END CONTEXT ---`;
  const providerInstance = createProvider(provider, policy);
  await providerInstance.run(
    { agentName: 'chat', cwd, systemPrompt, userMessage: question, policy },
    (_, text) => onChunk(text),
  );
}

export function registerChat(program: Command): void {
  program
    .command('chat')
    .description('Interactive Q&A about the codebase using repo index as context')
    .option('--budget <budget>', 'low | normal | deep', 'normal')
    .option('--provider <provider>', `AI provider: ${PROVIDER_NAMES.join(' | ')}`)
    .option('--model <model>', 'model override for openrouter/kimi/minimax')
    .option('--context-limit <n>', 'max chars of repo context injected (default: 6000)', '6000')
    .option('--no-history', 'start a fresh session without loading previous history')
    .option('--history', 'show last 10 Q&A pairs from history then exit')
    .option('--clear-history', 'clear all chat history and exit')
    .action(async (options: { budget: string; provider?: string; model?: string; contextLimit: string; history?: boolean; noHistory?: boolean; clearHistory?: boolean }) => {
      const cwd = process.cwd();
      const contextLimit = Math.max(1000, Math.min(20000, parseInt(options.contextLimit, 10) || 6000));
      const budget = ((BUDGET_NAMES as readonly string[]).includes(options.budget) ? options.budget : 'normal') as BudgetName;
      const provider: ProviderName = ((PROVIDER_NAMES as readonly string[]).includes(options.provider ?? '')
        ? options.provider as ProviderName
        : undefined)
        ?? (process.env['OPENROUTER_API_KEY'] ? 'openrouter' : process.env['MOONSHOT_API_KEY'] ? 'kimi' : process.env['MINIMAX_API_KEY'] ? 'minimax' : 'claude');

      // --clear-history: wipe history file and exit
      if (options.clearHistory) {
        const p = historyPath(cwd);
        if (existsSync(p)) {
          writeFileSync(p, '', 'utf8');
          console.log(chalk.green('  Chat history cleared.'));
        } else {
          console.log(chalk.dim('  No chat history to clear.'));
        }
        return;
      }

      // --history: show recent Q&A and exit
      if (options.history) {
        const entries = loadHistory(cwd, 20);
        if (entries.length === 0) {
          console.log(chalk.dim('  No chat history yet.'));
          return;
        }
        console.log(chalk.bold.cyan('\n  Chat History\n'));
        entries.forEach((e) => {
          const label = e.role === 'user' ? chalk.cyan('  You: ') : chalk.bold('  AI:  ');
          const preview = e.content.slice(0, 120) + (e.content.length > 120 ? '…' : '');
          console.log(label + preview);
        });
        console.log('');
        return;
      }

      const policyInput = {
        budget,
        ...(options.model ? { openrouterModel: options.model, kimiModel: options.model, minimaxModel: options.model } : {}),
        ...(provider !== 'claude' ? {
          plannerProvider: provider,
          investigatorProvider: provider,
          developerProvider: provider,
          reviewerProvider: provider,
        } : {}),
      };
      const policy = createRuntimePolicy(policyInput);
      const indexSpinner = ora('Building repository index…').start();
      const graph = new GraphAgent(cwd);
      let repoContext = '';
      try {
        repoContext = await graph.queryWithContext('architecture structure files modules', 20, contextLimit);
        indexSpinner.succeed(chalk.dim(`Repository index ready (${repoContext.length} chars context)`));
      } catch {
        repoContext = '(No repo index available)';
        indexSpinner.warn(chalk.yellow('No repo index available — code awareness is limited. Run `aion memory index` first.'));
      }

      // Load previous session
      const pastEntries = options.noHistory ? [] : loadHistory(cwd, 20);

      const projectName = displayProjectName(cwd);
      console.log(chalk.bold.cyan(`\n  💬 Aion Chat — ${projectName}`));
      console.log(chalk.dim(`  Provider: ${provider}  Budget: ${budget}  Context: ${repoContext.length} chars`));
      if (pastEntries.length > 0) {
        console.log(chalk.dim(`  Session resumed (${pastEntries.length} previous messages) — /history to review  /clear to reset`));
      }
      console.log(chalk.dim('  Type "exit" or Ctrl+C to quit.'));
      console.log(chalk.dim('  /context [query]  /history  /clear  /context-show\n'));

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.on('close', () => console.log(chalk.dim('\nBye!\n')));

      const ask = () => {
        rl.question(chalk.cyan('  You: '), async (raw) => {
          const question = raw.trim();
          if (!question || question === 'exit' || question === 'quit') { rl.close(); return; }

          if (question === '/history') {
            const entries = loadHistory(cwd, 10);
            console.log(chalk.dim('\n--- Recent history ---'));
            entries.forEach((e) => {
              const label = e.role === 'user' ? chalk.cyan('You: ') : chalk.bold('AI:  ');
              console.log('  ' + label + e.content.slice(0, 100) + (e.content.length > 100 ? '…' : ''));
            });
            console.log(chalk.dim('---\n'));
            ask(); return;
          }

          if (question === '/clear') {
            try { const { unlinkSync } = await import('fs'); unlinkSync(historyPath(cwd)); } catch { /* ok */ }
            console.log(chalk.dim('  History cleared.\n'));
            ask(); return;
          }

          if (question === '/context-show' || question === 'context') {
            console.log(chalk.dim('\n--- Injected context (first 800 chars) ---'));
            console.log(repoContext.slice(0, 800) + (repoContext.length > 800 ? '\n…' : ''));
            console.log(chalk.dim('---\n'));
            ask(); return;
          }

          if (question.startsWith('/context ') || question.startsWith('/context\n')) {
            const newQuery = question.slice('/context '.length).trim() || 'architecture structure files modules';
            try {
              repoContext = await graph.queryWithContext(newQuery, 20, contextLimit);
              console.log(chalk.dim(`  Context updated (${repoContext.length} chars)\n`));
            } catch { console.log(chalk.dim('  Could not update context\n')); }
            ask(); return;
          }

          appendHistory(cwd, { role: 'user', content: question, ts: new Date().toISOString() });

          process.stdout.write(chalk.bold('\n  AI: '));
          let gotOutput = false;
          let aiResponse = '';
          try {
            await askAI(cwd, question, repoContext, provider, policy, (chunk) => {
              gotOutput = true;
              aiResponse += chunk;
              process.stdout.write(chunk);
            });
          } catch (err) {
            console.error(chalk.red(`\n  Error: ${(err as Error).message}`));
          }
          if (!gotOutput) process.stdout.write(chalk.dim('(no response)'));
          if (!repoContext.endsWith('\n')) process.stdout.write('\n');
          console.log();

          if (aiResponse) appendHistory(cwd, { role: 'assistant', content: aiResponse, ts: new Date().toISOString() });

          ask();
        });
      };

      ask();
    });
}
