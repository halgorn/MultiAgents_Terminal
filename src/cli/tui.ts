import { emitKeypressEvents } from 'readline';
import chalk from 'chalk';

export interface MenuItem<T = string> {
  label: string;
  hint?: string;
  value: T;
  icon?: string;
  key?: string;
  separator?: boolean;
  header?: boolean;
}

function clearLines(n: number): void {
  for (let i = 0; i < n; i++) {
    process.stdout.write('\x1b[1A\x1b[2K');
  }
}

function hideCursor(): void { process.stdout.write('\x1b[?25l'); }
function showCursor(): void { process.stdout.write('\x1b[?25h'); }

function isSelectable<T>(item: MenuItem<T>): boolean {
  return !item.separator && !item.header;
}

function termCols(): number {
  return Math.min(process.stdout.columns ?? 50, 80);
}

function applyFilter<T>(items: MenuItem<T>[], q: string): MenuItem<T>[] {
  if (!q) return items;
  const lower = q.toLowerCase();
  return items.filter((it) =>
    it.separator || it.header ||
    it.label.toLowerCase().includes(lower) ||
    (it.hint && it.hint.toLowerCase().includes(lower)),
  );
}

function renderList<T>(
  title: string,
  items: MenuItem<T>[],
  selected: number,
  subtitle?: string,
  filter?: string,
): number {
  const lines: string[] = [];
  lines.push(chalk.bold.cyan(`  ${title}`));
  if (filter) {
    lines.push(chalk.cyan(`  / ${filter}`) + chalk.dim('  (Esc to clear)'));
  } else if (subtitle) {
    lines.push(chalk.dim(`  ${subtitle}`));
  }
  lines.push('');

  items.forEach((item, i) => {
    if (item.separator) {
      lines.push(chalk.dim('  ' + '─'.repeat(Math.min(termCols() - 4, 33))));
      return;
    }
    if (item.header) {
      lines.push(chalk.dim(`  ── ${item.label.toUpperCase()} ${'─'.repeat(Math.max(0, 30 - item.label.length))}`));
      return;
    }
    const cursor = i === selected ? chalk.cyan('❯') : ' ';
    const icon = item.icon ?? ' ';
    const label = i === selected ? chalk.bold.white(item.label) : chalk.white(item.label);
    const hint = item.hint ? chalk.dim(`  ${item.hint}`) : '';
    const shortcut = item.key ? chalk.dim(` [${item.key}]`) : '';
    lines.push(`  ${cursor} ${icon}  ${label}${hint}${shortcut}`);
  });

  lines.push('');
  if (filter) {
    lines.push(chalk.dim('  ↕ navigate  ↵ select  Esc clear  Ctrl+C quit'));
  } else {
    lines.push(chalk.dim('  ↕ navigate  ↵ select  / filter  q/esc quit'));
  }
  lines.forEach((l) => process.stdout.write(l + '\n'));
  return lines.length;
}

function renderMulti<T>(
  title: string,
  items: MenuItem<T>[],
  selected: number,
  toggled: Set<number>,
  subtitle?: string,
): number {
  const lines: string[] = [];
  lines.push(chalk.bold.cyan(`  ${title}`));
  if (subtitle) lines.push(chalk.dim(`  ${subtitle}`));
  lines.push('');

  items.forEach((item, i) => {
    if (item.separator) {
      lines.push(chalk.dim('  ' + '─'.repeat(Math.min(termCols() - 4, 33))));
      return;
    }
    if (item.header) {
      lines.push(chalk.dim(`  ── ${item.label.toUpperCase()} ${'─'.repeat(Math.max(0, 30 - item.label.length))}`));
      return;
    }
    const cursor = i === selected ? chalk.cyan('❯') : ' ';
    const check = toggled.has(i) ? chalk.green('☑') : chalk.gray('☐');
    const label = i === selected ? chalk.bold.white(item.label) : chalk.white(item.label);
    const hint = item.hint ? chalk.dim(`  ${item.hint}`) : '';
    lines.push(`  ${cursor} ${check}  ${label}${hint}`);
  });

  const selectedLabels = [...toggled].map((i) => items[i]?.label ?? '').join(', ');
  lines.push('');
  lines.push(selectedLabels
    ? chalk.green(`  Selected: ${selectedLabels}`)
    : chalk.dim('  None selected'));
  lines.push(chalk.dim('  ↕ navigate  Space toggle  ↵ confirm  q/esc cancel'));
  lines.forEach((l) => process.stdout.write(l + '\n'));
  return lines.length;
}

export async function selectOne<T>(
  title: string,
  items: MenuItem<T>[],
  subtitle?: string,
): Promise<T | null> {
  if (!process.stdin.isTTY) {
    process.stderr.write(`[aion] interactive menu requires a TTY — use CLI flags directly (e.g. aion audit . --preset security)\n`);
    return null;
  }

  let filter = '';
  let filtered = applyFilter(items, filter);
  let selected = filtered.findIndex((i) => isSelectable(i));
  if (selected === -1 && filtered.filter(isSelectable).length === 0) return null;
  let lineCount = 0;

  hideCursor();
  lineCount = renderList(title, filtered, selected, subtitle, filter);

  return new Promise((resolve) => {
    process.stdin.setRawMode!(true);
    emitKeypressEvents(process.stdin);

    const handler = (_: string | undefined, key: { name: string; ctrl?: boolean; sequence?: string }) => {
      if (!key) return;

      if (key.ctrl && key.name === 'c') { cleanup(); resolve(null); return; }

      if (key.name === 'escape') {
        if (filter) {
          filter = '';
          filtered = applyFilter(items, filter);
          selected = filtered.findIndex((i) => isSelectable(i));
        } else {
          cleanup(); resolve(null); return;
        }
      } else if (key.name === 'q' && !filter) {
        cleanup(); resolve(null); return;
      } else if (key.name === 'backspace') {
        if (filter) {
          filter = filter.slice(0, -1);
          filtered = applyFilter(items, filter);
          const prevSel = filtered.findIndex((i) => isSelectable(i));
          selected = Math.min(selected, filtered.length - 1);
          if (selected < 0 || !isSelectable(filtered[selected]!)) selected = prevSel;
        }
      } else if (key.name === 'up') {
        if (filtered.length > 0) {
          do { selected = (selected - 1 + filtered.length) % filtered.length; }
          while (!isSelectable(filtered[selected]!));
        }
      } else if (key.name === 'down') {
        if (filtered.length > 0) {
          do { selected = (selected + 1) % filtered.length; }
          while (!isSelectable(filtered[selected]!));
        }
      } else if (key.name === 'return') {
        const val = filtered[selected];
        if (val && isSelectable(val)) { cleanup(); resolve(val.value); return; }
      } else if (key.name === '/' && !filter) {
        // explicitly enter filter mode — harmless since '/' is not a valid shortcut
      } else if (key.name && key.name.length === 1 && !key.ctrl) {
        // check shortcuts first
        const shortcutIdx = filtered.findIndex((it) => isSelectable(it) && it.key === key.name);
        if (shortcutIdx !== -1) { cleanup(); resolve(filtered[shortcutIdx]!.value); return; }
        // accumulate filter (skip 'q' if already used for quit)
        if (key.name !== 'q' || filter) {
          filter += key.name;
          filtered = applyFilter(items, filter);
          const first = filtered.findIndex((i) => isSelectable(i));
          selected = first === -1 ? 0 : first;
        }
      }

      clearLines(lineCount);
      lineCount = renderList(title, filtered, selected, subtitle, filter);
    };

    const cleanup = () => {
      process.stdin.removeListener('keypress', handler);
      if (process.stdin.isTTY) process.stdin.setRawMode!(false);
      showCursor();
      clearLines(lineCount);
    };

    process.stdin.on('keypress', handler);
  });
}

export async function selectMany<T>(
  title: string,
  items: MenuItem<T>[],
  subtitle?: string,
  preSelected?: number[],
): Promise<T[] | null> {
  if (!process.stdin.isTTY) {
    process.stderr.write(`[aion] interactive menu requires a TTY — use CLI flags directly (e.g. aion audit . --domains security,bugs)\n`);
    return null;
  }

  let selected = items.findIndex((i) => isSelectable(i));
  if (selected === -1) return null;
  const toggled = new Set<number>(preSelected ?? []);
  let lineCount = 0;

  hideCursor();
  lineCount = renderMulti(title, items, selected, toggled, subtitle);

  return new Promise((resolve) => {
    process.stdin.setRawMode!(true);
    emitKeypressEvents(process.stdin);

    const handler = (_: string | undefined, key: { name: string; ctrl?: boolean; sequence?: string }) => {
      if (!key) return;
      if ((key.ctrl && key.name === 'c') || key.name === 'q' || key.name === 'escape') { cleanup(); resolve(null); return; }
      if (key.name === 'up') {
        do { selected = (selected - 1 + items.length) % items.length; }
        while (!isSelectable(items[selected]!));
      }
      if (key.name === 'down') {
        do { selected = (selected + 1) % items.length; }
        while (!isSelectable(items[selected]!));
      }
      if (key.name === 'space' && isSelectable(items[selected]!)) {
        if (toggled.has(selected)) toggled.delete(selected);
        else toggled.add(selected);
      }
      if (key.name === 'return') {
        const result = [...toggled].map((i) => items[i]!.value);
        cleanup();
        resolve(result);
        return;
      }
      clearLines(lineCount);
      lineCount = renderMulti(title, items, selected, toggled, subtitle);
    };

    const cleanup = () => {
      process.stdin.removeListener('keypress', handler);
      if (process.stdin.isTTY) process.stdin.setRawMode!(false);
      showCursor();
      clearLines(lineCount);
    };

    process.stdin.on('keypress', handler);
  });
}

export function printHeader(projectName: string, extra?: string): void {
  const width = Math.min(termCols(), 60);
  const line = chalk.dim('─'.repeat(width));
  console.log(line);
  console.log(chalk.bold.cyan(`  🤖 AI Runtime`) + chalk.gray(` — ${projectName}`));
  if (extra) console.log(chalk.dim(`  ${extra}`));
  console.log(line);
  console.log('');
}
