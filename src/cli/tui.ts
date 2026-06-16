import { emitKeypressEvents } from 'readline';
import chalk from 'chalk';

export interface MenuItem<T = string> {
  label: string;
  hint?: string;
  description?: string;  // shown in right pane when terminal is wide enough
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

function visLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function padRight(s: string, width: number): string {
  const pad = width - visLen(s);
  return s + (pad > 0 ? ' '.repeat(pad) : '');
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
  filter?: string,  // undefined = navigate mode; string (even '') = filter mode
): number {
  const lines: string[] = [];
  lines.push(chalk.bold.cyan(`  ${title}`));
  if (filter !== undefined) {
    const cursor = filter ? chalk.dim(' ▌') : chalk.dim(' type to filter…');
    lines.push(chalk.cyan(`  / ${filter}`) + cursor + chalk.dim('  Esc to exit'));
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
  if (filter !== undefined) {
    lines.push(chalk.dim('  type to filter   ↑↓/jk move   ↵ select   Esc exit'));
  } else {
    lines.push(chalk.dim('  ↑↓/jk move   ↵ select   / filter   q/Esc quit'));
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

function renderListTwoPane<T>(
  title: string,
  items: MenuItem<T>[],
  selected: number,
  subtitle?: string,
  filter?: string,
): number {
  const cols = process.stdout.columns ?? 80;
  if (cols < 90) return renderList(title, items, selected, subtitle, filter);

  const LEFT_W = Math.min(46, Math.floor(cols * 0.48));
  const RIGHT_W = cols - LEFT_W - 4;

  // Build left column
  const left: string[] = [];
  left.push(`  ${chalk.bold.cyan(title)}`);
  if (filter !== undefined) {
    const cur = filter ? chalk.dim(' ▌') : chalk.dim(' type to filter…');
    left.push(`  ${chalk.cyan(`/ ${filter}`)}${cur}  ${chalk.dim('Esc exit')}`);
  } else if (subtitle) {
    left.push(chalk.dim(`  ${subtitle}`));
  } else {
    left.push('');
  }
  left.push('');

  items.forEach((item, i) => {
    if (item.separator) {
      left.push(chalk.dim('  ' + '─'.repeat(LEFT_W - 4)));
      return;
    }
    if (item.header) {
      const h = `  ── ${item.label.toUpperCase()} `;
      left.push(chalk.dim(h + '─'.repeat(Math.max(0, LEFT_W - h.length - 2))));
      return;
    }
    const cur = i === selected ? chalk.cyan('❯') : ' ';
    const icon = item.icon ?? ' ';
    const lbl = i === selected ? chalk.bold.white(item.label) : chalk.white(item.label);
    const sc = item.key ? chalk.dim(` [${item.key}]`) : '';
    left.push(`  ${cur} ${icon}  ${lbl}${sc}`);
  });

  left.push('');
  left.push(filter !== undefined
    ? chalk.dim('  ↕/jk move   ↵ select   Esc exit')
    : chalk.dim('  ↕/jk   ↵   / filter   q quit'));

  // Build right column from description or hint of selected item
  const right: string[] = [];
  const sel = items[selected];
  if (sel && !sel.separator && !sel.header) {
    const desc = sel.description ?? sel.hint;
    if (desc) {
      right.push('');
      right.push(chalk.bold.white(`  ${sel.label}`));
      right.push(chalk.dim('  ' + '─'.repeat(Math.min(RIGHT_W - 4, 36))));
      right.push('');
      const words = desc.split(' ');
      let ln = '';
      for (const w of words) {
        if ((ln + w).length > RIGHT_W - 4) {
          if (ln.trim()) right.push(chalk.dim(`  ${ln.trim()}`));
          ln = w + ' ';
        } else {
          ln += w + ' ';
        }
      }
      if (ln.trim()) right.push(chalk.dim(`  ${ln.trim()}`));
    }
  }

  // Render side-by-side
  const sep = chalk.dim('│');
  const rows = Math.max(left.length, right.length);
  for (let r = 0; r < rows; r++) {
    process.stdout.write(`${padRight(left[r] ?? '', LEFT_W)} ${sep} ${right[r] ?? ''}\n`);
  }
  return rows;
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

  let filterMode = false;
  let filter = '';
  let filtered = items;
  let selected = filtered.findIndex((i) => isSelectable(i));
  if (selected === -1 && filtered.filter(isSelectable).length === 0) return null;
  let lineCount = 0;

  hideCursor();
  lineCount = renderListTwoPane(title, filtered, selected, subtitle, undefined);

  return new Promise((resolve) => {
    process.stdin.setRawMode!(true);
    emitKeypressEvents(process.stdin);

    const moveUp = () => {
      if (filtered.length > 0) {
        do { selected = (selected - 1 + filtered.length) % filtered.length; }
        while (!isSelectable(filtered[selected]!));
      }
    };
    const moveDown = () => {
      if (filtered.length > 0) {
        do { selected = (selected + 1) % filtered.length; }
        while (!isSelectable(filtered[selected]!));
      }
    };

    const handler = (_: string | undefined, key: { name: string; ctrl?: boolean; sequence?: string }) => {
      if (!key) return;
      if (key.ctrl && key.name === 'c') { cleanup(); resolve(null); return; }

      if (filterMode) {
        // ── Filter mode ──────────────────────────────────────────────────
        if (key.name === 'escape' || (key.name === 'backspace' && !filter)) {
          filterMode = false;
          filter = '';
          filtered = items;
          selected = Math.max(0, filtered.findIndex((i) => isSelectable(i)));
        } else if (key.name === 'backspace') {
          filter = filter.slice(0, -1);
          filtered = applyFilter(items, filter);
          const first = filtered.findIndex((i) => isSelectable(i));
          selected = first === -1 ? 0 : first;
        } else if (key.name === 'return') {
          const val = filtered[selected];
          if (val && isSelectable(val)) { cleanup(); resolve(val.value); return; }
        } else if (key.name === 'up' || key.name === 'k') {
          moveUp();
        } else if (key.name === 'down' || key.name === 'j') {
          moveDown();
        } else if (key.name && key.name.length === 1 && !key.ctrl) {
          filter += key.name;
          filtered = applyFilter(items, filter);
          const first = filtered.findIndex((i) => isSelectable(i));
          selected = first === -1 ? 0 : first;
        }
      } else {
        // ── Navigate mode ────────────────────────────────────────────────
        if (key.name === 'escape' || key.name === 'q') {
          cleanup(); resolve(null); return;
        } else if (key.name === '/') {
          filterMode = true;
          filter = '';
          filtered = items;
        } else if (key.name === 'up' || key.name === 'k') {
          moveUp();
        } else if (key.name === 'down' || key.name === 'j') {
          moveDown();
        } else if (key.name === 'return') {
          const val = filtered[selected];
          if (val && isSelectable(val)) { cleanup(); resolve(val.value); return; }
        } else if (key.name && key.name.length === 1 && !key.ctrl) {
          // Shortcuts only in navigate mode — no accidental filter activation
          const shortcutIdx = filtered.findIndex((it) => isSelectable(it) && it.key === key.name);
          if (shortcutIdx !== -1) { cleanup(); resolve(filtered[shortcutIdx]!.value); return; }
        }
      }

      clearLines(lineCount);
      lineCount = renderListTwoPane(title, filtered, selected, subtitle, filterMode ? filter : undefined);
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
      if (key.name === 'up' || key.name === 'k') {
        do { selected = (selected - 1 + items.length) % items.length; }
        while (!isSelectable(items[selected]!));
      }
      if (key.name === 'down' || key.name === 'j') {
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
