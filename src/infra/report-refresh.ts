import { spawn } from 'child_process';
import chalk from 'chalk';
import { buildProjectReportData, writeProjectReport } from './project-report.js';

export interface RefreshReportOptions {
  days?: number;
  open?: boolean;
  quiet?: boolean;
  mdOnly?: boolean;
  reason?: string;
}

export function terminalFileLink(label: string, path: string): string {
  const url = `file://${path}`;
  return `\x1b]8;;${url}\x1b\\${label}\x1b]8;;\x1b\\`;
}

export function openReportFile(path: string): void {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const target = process.platform === 'win32' ? path : `file://${path}`;
  const args = process.platform === 'win32' ? ['/c', 'start', '', path] : [target];
  try {
    const child = spawn(opener, args, { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {
    // Opening the browser is best-effort. The terminal link/path remains available.
  }
}

export async function refreshUnifiedReport(cwd: string, options: RefreshReportOptions = {}): Promise<{ htmlFile?: string; mdFile: string }> {
  const shouldOpen = options.open ?? Boolean(process.stdout.isTTY);
  const progress = !options.quiet;
  if (progress) {
    const label = options.reason ?? 'updating dashboard';
    console.log(chalk.bold.cyan(`\n${label}\n`));
  }
  const data = await buildProjectReportData(cwd, options.days ?? 90, progress ? (message) => {
    console.log(chalk.gray(`  • ${message}`));
  } : undefined);
  if (!options.mdOnly) {
    try {
      if (progress) console.log(chalk.gray('  • generating interactive graph'));
      const { ensureRepoIndex } = await import('./repo-query.js');
      const { detectLang } = await import('./lang-detect.js');
      const { buildDepGraphAuto } = await import('./dep-graph.js');
      const { writeGraphHtml } = await import('../cli/commands/graph.js');
      const index = await ensureRepoIndex(cwd);
      const dep = buildDepGraphAuto(cwd, detectLang(cwd).lang);
      writeGraphHtml(cwd, index, dep);
    } catch {
      // The inline architecture graph in project.html remains available.
    }
  }
  const written = writeProjectReport(cwd, data, Boolean(options.mdOnly));

  if (progress && written.htmlFile) {
    console.log(chalk.gray(`  HTML: ${written.htmlFile}`));
    console.log(chalk.bold.cyan('  📊 ') + terminalFileLink(chalk.bold.cyan('Open dashboard →'), written.htmlFile));
  }
  if (shouldOpen && written.htmlFile) openReportFile(written.htmlFile);
  return { htmlFile: written.htmlFile, mdFile: written.mdFile };
}
