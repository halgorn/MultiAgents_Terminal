import type { Command } from 'commander';
import chalk from 'chalk';

interface ProviderInfo {
  name: string;
  label: string;
  envVar: string;
  modelEnvVar?: string;
  defaultModel: string;
  note?: string;
}

const PROVIDERS: ProviderInfo[] = [
  {
    name: 'claude',
    label: 'Anthropic Claude',
    envVar: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-sonnet-4-5',
  },
  {
    name: 'openrouter',
    label: 'OpenRouter',
    envVar: 'OPENROUTER_API_KEY',
    modelEnvVar: 'OPENROUTER_MODEL',
    defaultModel: 'anthropic/claude-3.5-sonnet',
  },
  {
    name: 'kimi',
    label: 'Moonshot Kimi',
    envVar: 'MOONSHOT_API_KEY',
    modelEnvVar: 'KIMI_MODEL',
    defaultModel: 'moonshot-v1-8k',
  },
  {
    name: 'minimax',
    label: 'MiniMax',
    envVar: 'MINIMAX_API_KEY',
    modelEnvVar: 'MINIMAX_MODEL',
    defaultModel: 'abab6.5s-chat',
  },
  {
    name: 'codex',
    label: 'OpenAI Codex CLI',
    envVar: 'OPENAI_API_KEY',
    defaultModel: 'codex-mini-latest',
    note: 'requires `npm i -g @openai/codex`',
  },
];

export function registerProviders(program: Command): void {
  program
    .command('providers')
    .description('Show available AI providers and which are configured')
    .action(() => {
      const ok = chalk.green('✓');
      const no = chalk.dim('○');

      console.log(chalk.bold.cyan('\nAI Providers\n'));

      let activeCount = 0;
      for (const p of PROVIDERS) {
        const hasKey = Boolean(process.env[p.envVar]);
        const icon = hasKey ? ok : no;
        const name = hasKey ? chalk.bold.white(p.name) : chalk.dim(p.name);
        const label = chalk.dim(`(${p.label})`);

        if (hasKey) {
          activeCount++;
          const model = p.modelEnvVar && process.env[p.modelEnvVar]
            ? process.env[p.modelEnvVar]
            : p.defaultModel;
          console.log(`  ${icon}  ${name} ${label}`);
          console.log(`       model: ${chalk.cyan(model!)}`);
          if (p.note) console.log(chalk.dim(`       ${p.note}`));
        } else {
          console.log(`  ${icon}  ${name} ${label}`);
          console.log(chalk.dim(`       export ${p.envVar}=...`));
          if (p.note) console.log(chalk.dim(`       ${p.note}`));
        }
      }

      console.log('');

      if (activeCount === 0) {
        console.log(chalk.yellow('  No provider configured. Set at least one API key:'));
        console.log(chalk.dim('    export ANTHROPIC_API_KEY=sk-ant-...'));
        console.log(chalk.dim('    export OPENROUTER_API_KEY=sk-or-...'));
      } else {
        const active = PROVIDERS.filter((p) => Boolean(process.env[p.envVar]));
        const primary = active[0]!;
        console.log(`  Active provider: ${chalk.cyan(primary.name)}`);
        if (active.length > 1) {
          console.log(chalk.dim(`  (${active.length - 1} additional provider(s) also configured)`));
        }
      }
      console.log('');
    });
}
