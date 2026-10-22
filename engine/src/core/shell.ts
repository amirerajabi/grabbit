import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Open a file with its default app, or show it in the file manager. Arguments go straight to the OS, never a shell. */
export function openPath(target: string, reveal: boolean): void {
  if (!fs.existsSync(target)) {
    if (reveal && fs.existsSync(path.dirname(target))) target = path.dirname(target);
    else throw new Error('The file no longer exists');
    reveal = false;
  }
  const detached = { detached: true, stdio: 'ignore' as const };
  if (process.platform === 'win32') {
    spawn('explorer.exe', reveal ? [`/select,${target}`] : [target], detached).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', reveal ? ['-R', target] : [target], detached).unref();
  } else {
    spawn('xdg-open', [reveal ? path.dirname(target) : target], detached).unref();
  }
}
