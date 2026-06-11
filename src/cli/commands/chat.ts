import type { Command } from 'commander';
import chalk from 'chalk';
import * as readline from 'readline';
import { GraphAgent } from '../../agents/graph-agent.js';
import { createRuntimePolicy, BUDGET_NAMES, PROVIDER_NAMES, type ProviderName, type BudgetName, type RuntimePolicy } from '../../core/runtime-policy.js';
import { displayProjectName } from '../../infra/project-name.js';
import { createProvider } from '../../providers/cli-provider.js';

const SYSTEM_PROMPT = `You are an expert code assistant with deep knowledge of this repository.
Answer questions concisely based on the provided repository context.
When citing code locations use file:line format.
Never invent file paths or function names not shown in context.
If unsure, say so rather than guessing.`;

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
    .action(async (options: { budget: string; provider?: string; model?: string; contextLimit: string }) => {
      const cwd = process.cwd();
      const contextLimit = Math.max(1000, Math.min(20000, parseInt(options.contextLimit, 10) || 6000));
      const budget = ((BUDGET_NAMES as readonly string[]).includes(options.budget) ? options.budget : 'normal') as BudgetName;
      const provider: ProviderName = (options.provider as ProviderName | undefined)
        ?? (process.env['OPENROUTER_API_KEY'] ? 'openrouter' : process.env['MOONSHOT_API_KEY'] ? 'kimi' : process.env['MINIMAX_API_KEY'] ? 'minimax' : 'claude');

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
      console.log(chalk.dim('\nBuilding repository index…'));
      const graph = new GraphAgent(cwd);
      let repoContext = '';
      try {
        repoContext = await graph.queryWithContext('architecture structure files modules', 20, contextLimit);
      } catch {
        repoContext = '(No repo index available)';
      }

      const projectName = displayProjectName(cwd);
      console.log(chalk.bold.cyan(`\n  💬 Aion Chat — ${projectName}`));
      console.log(chalk.dim(`  Provider: ${provider}  Budget: ${budget}  Context: ${repoContext.length} chars`));
      console.log(chalk.dim('  Type "exit" or Ctrl+C to quit.'));
      console.log(chalk.dim('  Special: "context" to show injected context, "/context <query>" to refresh it.\n'));

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

      rl.on('close', () => console.log(chalk.dim('\nBye!\n')));

      const ask = () => {
        rl.question(chalk.cyan('  You: '), async (raw) => {
          const question = raw.trim();

          if (!question || question === 'exit' || question === 'quit') {
            rl.close();
            return;
          }

          if (question === 'context') {
            console.log(chalk.dim('\n--- Injected context (first 800 chars) ---'));
            console.log(repoContext.slice(0, 800) + (repoContext.length > 800 ? '\n…' : ''));
            console.log(chalk.dim('---\n'));
            ask();
            return;
          }

          if (question.startsWith('/context ')) {
            const newQuery = question.slice('/context '.length);
            try {
              repoContext = await graph.queryWithContext(newQuery, 20, contextLimit);
              console.log(chalk.dim(`  Context updated (${repoContext.length} chars)\n`));
            } catch { console.log(chalk.dim('  Could not update context\n')); }
            ask();
            return;
          }

          process.stdout.write(chalk.bold('\n  AI: '));
          let gotOutput = false;
          try {
            await askAI(cwd, question, repoContext, provider, policy, (chunk) => {
              gotOutput = true;
              process.stdout.write(chunk);
            });
          } catch (err) {
            console.error(chalk.red(`\n  Error: ${(err as Error).message}`));
          }
          if (!gotOutput) process.stdout.write(chalk.dim('(no response)'));
          if (!repoContext.endsWith('\n')) process.stdout.write('\n');
          console.log();
          ask();
        });
      };

      ask();
    });
}
