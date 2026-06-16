import type { Command } from 'commander';
import { spawnSync, execFileSync } from 'child_process';
import chalk from 'chalk';

function getChangedFiles(cwd: string): string[] {
  try {
    const staged = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
    const unstaged = execFileSync('git', ['diff', '--name-only'], { cwd, encoding: 'utf8' }).trim();
    const all = new Set([...staged.split('\n'), ...unstaged.split('\n')].filter(Boolean));
    return [...all];
  } catch { return []; }
}

function getDiffHash(cwd: string): string {
  try {
    return execFileSync('git', ['diff', 'HEAD', '--stat'], { cwd, encoding: 'utf8' });
  } catch { return ''; }
}

export function registerWatch(program: Command): void {
  program
    .command('watch [target]')
    .description('Watch for file changes and auto-run local scan on modified files')
    .option('--interval <seconds>', 'polling interval in seconds', '10')
    .option('--cmd <command>', 'aion subcommand to run on change (default: audit . --local-only)', 'audit . --local-only')
    .option('--json', 'emit JSON lines for each event (for piping/scripting)')
    .action((_target: string = '.', options: { interval: string; cmd: string; json?: boolean }) => {
      const cwd = process.cwd();
      const intervalMs = Math.max(3, parseInt(options.interval, 10) || 10) * 1000;
      const cmdArgs = options.cmd.split(/\s+/).filter(Boolean);
      const emit = (obj: Record<string, unknown>) => process.stdout.write(JSON.stringify({ ...obj, ts: new Date().toISOString() }) + '\n');

      if (options.json) {
        emit({ type: 'start', cwd, interval: intervalMs / 1000, cmd: cmdArgs.join(' ') });
      } else {
        console.log(chalk.bold.cyan(`\n  👁  aion watch — ${cwd}`));
        console.log(chalk.dim(`  Polling every ${intervalMs / 1000}s  ·  Ctrl+C to stop`));
        console.log(chalk.dim(`  Command on change: aion ${cmdArgs.join(' ')}\n`));
      }

      const runScan = (changed: string[]) => {
        if (options.json) {
          emit({ type: 'change', files: changed });
        } else {
          console.log(chalk.yellow(`\n  ⚡ ${changed.length} file(s) changed — running scan...`));
          changed.slice(0, 10).forEach((f) => console.log(chalk.dim(`    · ${f}`)));
          if (changed.length > 10) console.log(chalk.dim(`    ... and ${changed.length - 10} more`));
          console.log('');
        }
        const result = spawnSync(process.execPath, [process.argv[1]!, '--cwd', cwd, ...cmdArgs], {
          stdio: options.json ? 'pipe' : 'inherit',
          env: process.env,
        });
        if (options.json) {
          emit({ type: 'scan_done', status: result.status ?? 0, stdout: result.stdout?.toString().trim() ?? '', stderr: result.stderr?.toString().trim() ?? '' });
        } else {
          console.log(chalk.dim(`\n  ── done — watching again (${new Date().toLocaleTimeString()}) ──\n`));
        }
      };

      let lastHash = getDiffHash(cwd);
      let scanning = false;

      const timer = setInterval(() => {
        if (scanning) return;
        const hash = getDiffHash(cwd);
        if (hash !== lastHash) {
          lastHash = hash;
          const changed = getChangedFiles(cwd);
          if (changed.length > 0) {
            scanning = true;
            runScan(changed);
            lastHash = getDiffHash(cwd);
            scanning = false;
          }
        }
      }, intervalMs);

      process.stdin.resume();
      process.on('SIGINT', () => {
        clearInterval(timer);
        if (options.json) {
          emit({ type: 'stop' });
        } else {
          console.log(chalk.dim('\n  Watch stopped.\n'));
        }
        process.exit(0);
      });
    });
}
