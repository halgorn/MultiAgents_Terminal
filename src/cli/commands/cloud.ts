import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { analyzeCloud, detectProviders, type CloudProvider } from '../../infra/cloud-analyzer.js';

const PROVIDER_LABELS: Record<CloudProvider, string> = {
  aws:   'AWS (Amazon Web Services)',
  azure: 'Azure (Microsoft)',
  gcp:   'GCP (Google Cloud)',
};

export function registerCloud(program: Command): void {
  const cloud = program
    .command('cloud')
    .description('Read-only cloud infrastructure analysis — identifies gaps between code and cloud');

  // ── aion cloud status ─────────────────────────────────────────────────────
  cloud
    .command('status')
    .description('Show which cloud providers are detected and authenticated')
    .action(() => {
      const detected = detectProviders();

      console.log(chalk.bold('\nCloud provider detection\n'));

      const checks: Array<{ provider: CloudProvider; envVars: string[] }> = [
        { provider: 'aws',   envVars: ['AWS_ACCESS_KEY_ID', 'AWS_PROFILE', 'AWS_DEFAULT_REGION'] },
        { provider: 'azure', envVars: ['AZURE_SUBSCRIPTION_ID', 'AZURE_TENANT_ID', 'AZURE_CLIENT_ID'] },
        { provider: 'gcp',   envVars: ['GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT'] },
      ];

      for (const { provider, envVars } of checks) {
        const active = detected.includes(provider);
        const icon = active ? chalk.green('✓') : chalk.gray('✗');
        console.log(`  ${icon} ${PROVIDER_LABELS[provider]}`);
        const found = envVars.filter((v) => process.env[v]);
        if (found.length > 0) {
          found.forEach((v) => console.log(chalk.gray(`      ${v}=${process.env[v]?.slice(0, 20)}...`)));
        } else {
          console.log(chalk.gray(`      Set one of: ${envVars.join(', ')}`));
        }
      }

      if (detected.length === 0) {
        console.log(chalk.gray('\n  No cloud providers configured.'));
        console.log(chalk.gray('  Export AWS_ACCESS_KEY_ID, AZURE_SUBSCRIPTION_ID, or GOOGLE_CLOUD_PROJECT.'));
      } else {
        console.log(chalk.gray(`\n  Run \`aion cloud analyze --provider ${detected[0]}\` to start.`));
      }
    });

  // ── aion cloud analyze ────────────────────────────────────────────────────
  cloud
    .command('analyze')
    .description('Read cloud resources and identify gaps with this project (read-only)')
    .option('--provider <p>', 'aws | azure | gcp (auto-detected if omitted)')
    .option('--json', 'output as JSON')
    .action(async (options: { provider?: string; json?: boolean }) => {
      const cwd = process.cwd();

      let provider = options.provider as CloudProvider | undefined;
      if (!provider) {
        const detected = detectProviders();
        if (detected.length === 0) {
          console.error(chalk.red('No cloud provider detected. Export AWS_ACCESS_KEY_ID, AZURE_SUBSCRIPTION_ID, or GOOGLE_CLOUD_PROJECT.'));
          process.exit(1);
        }
        provider = detected[0]!;
        console.log(chalk.gray(`Auto-detected provider: ${provider}`));
      }

      if (!['aws', 'azure', 'gcp'].includes(provider)) {
        console.error(chalk.red(`Unknown provider: ${provider}. Use aws, azure, or gcp.`));
        process.exit(1);
      }

      const spinner = ora(`Connecting to ${PROVIDER_LABELS[provider]} (read-only)...`).start();
      const report = analyzeCloud(cwd, provider);
      spinner.stop();

      if (options.json) { console.log(JSON.stringify(report, null, 2)); return; }

      if (!report.authenticated) {
        console.error(chalk.red(`\n  ${report.summary}`));
        console.error(chalk.gray('  Make sure the CLI is installed and authenticated.'));
        process.exit(1);
      }

      console.log(chalk.bold(`\n${PROVIDER_LABELS[provider]} — ${report.summary}\n`));

      if (report.resources.length > 0) {
        console.log(chalk.bold('Resources found:'));
        const byType = new Map<string, typeof report.resources>();
        for (const r of report.resources) {
          const list = byType.get(r.type) ?? [];
          list.push(r);
          byType.set(r.type, list);
        }
        for (const [type, items] of byType) {
          console.log(`  ${chalk.cyan(type.padEnd(12))} ${items.length} — ${items.slice(0, 3).map((i) => i.name).join(', ')}${items.length > 3 ? ` +${items.length - 3}` : ''}`);
        }
        console.log();
      }

      if (report.gaps.length === 0) {
        console.log(chalk.green('No infrastructure gaps detected.'));
        return;
      }

      console.log(chalk.bold('Gaps detected:'));
      for (const gap of report.gaps) {
        const color = gap.severity === 'high' ? chalk.red : gap.severity === 'medium' ? chalk.yellow : chalk.gray;
        console.log(`  ${color('●')} ${color.bold(gap.description)}`);
        console.log(chalk.gray(`    ${gap.detail}`));
      }

      console.log(chalk.gray('\n  Analysis is read-only — no changes were made to your cloud account.'));
    });

  // ── aion cloud gaps ───────────────────────────────────────────────────────
  cloud
    .command('gaps')
    .description('Show only infrastructure gaps (no resource listing)')
    .option('--provider <p>', 'aws | azure | gcp (auto-detected if omitted)')
    .option('--severity <s>', 'filter by: high | medium | low')
    .action(async (options: { provider?: string; severity?: string }) => {
      const cwd = process.cwd();
      let provider = options.provider as CloudProvider | undefined;
      if (!provider) {
        const detected = detectProviders();
        if (detected.length === 0) { console.error(chalk.red('No cloud provider detected.')); process.exit(1); }
        provider = detected[0]!;
      }

      const spinner = ora('Reading cloud state...').start();
      const report = analyzeCloud(cwd, provider as CloudProvider);
      spinner.stop();

      if (!report.authenticated) { console.error(chalk.red(report.summary)); process.exit(1); }

      const gaps = options.severity
        ? report.gaps.filter((g) => g.severity === options.severity)
        : report.gaps;

      if (gaps.length === 0) {
        console.log(chalk.green('\nNo gaps found.'));
        return;
      }

      console.log(chalk.bold(`\n${gaps.length} gap(s) — ${provider?.toUpperCase()}\n`));
      for (const g of gaps) {
        const color = g.severity === 'high' ? chalk.red : g.severity === 'medium' ? chalk.yellow : chalk.gray;
        console.log(`  ${color(`[${g.severity.toUpperCase()}]`)} ${g.description}`);
        console.log(chalk.gray(`           ${g.detail}\n`));
      }
    });
}
