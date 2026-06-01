import { spawnSync } from 'child_process';

function tmux(args: string[]): { ok: boolean; stdout: string } {
  const result = spawnSync('tmux', args, { encoding: 'utf8' });
  return { ok: result.status === 0, stdout: result.stdout ?? '' };
}

function isTmuxAvailable(): boolean {
  const result = spawnSync('which', ['tmux'], { encoding: 'utf8' });
  return result.status === 0;
}

export class TmuxManager {
  readonly available: boolean;

  constructor() {
    this.available = isTmuxAvailable();
  }

  createSession(sessionName: string): boolean {
    if (!this.available) return false;
    const { ok } = tmux(['new-session', '-d', '-s', sessionName]);
    return ok;
  }

  createWindow(sessionName: string, windowName: string): string | null {
    if (!this.available) return null;
    const target = `${sessionName}:${windowName}`;
    tmux(['new-window', '-t', sessionName, '-n', windowName]);
    return target;
  }

  writeToPane(target: string, text: string): void {
    if (!this.available) return;
    // Send text line by line; each line is a separate send-keys call
    for (const line of text.split('\n')) {
      tmux(['send-keys', '-t', target, line, 'Enter']);
    }
  }

  killSession(sessionName: string): void {
    if (!this.available) return;
    tmux(['kill-session', '-t', sessionName]);
  }
}
