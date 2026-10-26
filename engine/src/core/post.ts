// What happens after a download's bytes are on disk: checksum verification, a virus scan, and the one-shot power action
// once everything is done. Archive extraction lives in extract.ts. Each step only reads the finished file; the manager
// (DownloadManager.postProcess) runs them in order and records the outcome on the item.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ChecksumInfo, HashAlgo, WhenDoneAction } from '../../../shared/protocol';

// ------------------------------------------------------------------ checksums

const BY_LENGTH: Record<number, HashAlgo> = { 32: 'md5', 40: 'sha1', 64: 'sha256', 128: 'sha512' };
const ALGOS: HashAlgo[] = ['md5', 'sha1', 'sha256', 'sha512'];

/**
 * "sha256:ABC…", "ABC…" (the algorithm follows from the length) or a line from a SHA256SUMS file ("<hex>  name").
 * Returns null for anything that is not a recognisable hash.
 */
export function parseChecksum(input: string | null | undefined): ChecksumInfo | null {
  if (!input) return null;
  let text = input.trim();
  let algo: HashAlgo | null = null;
  const prefixed = /^(md5|sha-?1|sha-?256|sha-?512)\s*[:=]\s*(.+)$/i.exec(text);
  if (prefixed) {
    algo = prefixed[1].toLowerCase().replace('-', '') as HashAlgo;
    text = prefixed[2].trim();
  }
  const hex = /^([0-9a-fA-F]+)(\s|$)/.exec(text)?.[1]?.toLowerCase();
  if (!hex) return null;
  algo ??= BY_LENGTH[hex.length] ?? null;
  if (!algo || BY_LENGTH[hex.length] !== algo) return null;
  return { algo, expected: hex, actual: null, state: 'pending' };
}

export function isHashAlgo(v: unknown): v is HashAlgo {
  return typeof v === 'string' && (ALGOS as string[]).includes(v);
}

/** Streams the file through the hash, so multi-gigabyte files never sit in memory. */
export function hashFile(file: string, algo: HashAlgo): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash(algo);
    const s = fs.createReadStream(file, { highWaterMark: 1024 * 1024 });
    s.on('data', (c) => h.update(c));
    s.on('error', reject);
    s.on('end', () => resolve(h.digest('hex')));
  });
}

// ------------------------------------------------------------------ virus scan

export interface ScanResult {
  result: 'clean' | 'threat' | 'failed';
  message: string | null;
}

/** Microsoft Defender's command-line scanner, when it is installed (Windows). */
function defenderPath(): string | null {
  if (process.platform !== 'win32') return null;
  const candidates = [
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Windows Defender', 'MpCmdRun.exe'),
    // Platform updates install a newer copy here.
    ...listDirs(path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'Microsoft', 'Windows Defender', 'Platform')).map((d) => path.join(d, 'MpCmdRun.exe')).reverse(),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function listDirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir).sort().map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}

/** Split a command line into arguments (quotes group words); never handed to a shell. */
export function splitCommand(cmd: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (let m; (m = re.exec(cmd)); ) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    let output = '';
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch (e) {
      resolve({ code: null, output: String(e) });
      return;
    }
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout?.on('data', (d) => (output += d));
    child.stderr?.on('data', (d) => (output += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: null, output: String(e) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output: output.slice(-4000) });
    });
  });
}

/**
 * Scan one file. With no custom command: Microsoft Defender on Windows (exit 0 = clean, 2 = threat). A custom command
 * gets the path where it says {file} (or as the last argument); exit 0 = clean, 1 = threat (ClamAV's convention).
 */
export async function scanFile(file: string, command: string): Promise<ScanResult> {
  let cmd: string;
  let args: string[];
  let threatCode: number;
  if (command.trim()) {
    const parts = splitCommand(command);
    cmd = parts[0];
    const rest = parts.slice(1);
    args = rest.includes('{file}') ? rest.map((a) => (a === '{file}' ? file : a)) : [...rest, file];
    threatCode = 1;
  } else {
    const defender = defenderPath();
    if (!defender) return { result: 'failed', message: 'No virus scanner found. Set a scanner command in Options → After download.' };
    cmd = defender;
    args = ['-Scan', '-ScanType', '3', '-File', file, '-DisableRemediation'];
    threatCode = 2;
  }
  const { code, output } = await run(cmd, args, 10 * 60_000);
  if (code === 0) return { result: 'clean', message: null };
  if (code === threatCode) return { result: 'threat', message: lastLines(output) || 'The scanner reported a threat.' };
  return { result: 'failed', message: lastLines(output) || `The scanner exited with code ${code}.` };
}

function lastLines(s: string): string {
  return s.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' ').slice(0, 400);
}

// ------------------------------------------------------------------ power actions

/** The OS command for a power action. 'quit' is the desktop app's job, not a command. */
export function powerCommand(action: WhenDoneAction, platform = process.platform): [string, string[]] | null {
  if (action === 'nothing' || action === 'quit') return null;
  if (platform === 'win32') {
    if (action === 'shutdown') return ['shutdown', ['/s', '/t', '0']];
    if (action === 'hibernate') return ['shutdown', ['/h']];
    // Sleep: SetSuspendState(hibernate = 0, force = 1, wakeup events = 0).
    return ['rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']];
  }
  if (platform === 'darwin') {
    if (action === 'shutdown') return ['osascript', ['-e', 'tell app "System Events" to shut down']];
    return ['pmset', ['sleepnow']]; // macOS has no user-facing hibernate; sleep is the closest
  }
  if (action === 'shutdown') return ['systemctl', ['poweroff']];
  if (action === 'hibernate') return ['systemctl', ['hibernate']];
  return ['systemctl', ['suspend']];
}

/** Runs the power action. GRABBIT_POWER_DRY_RUN=1 only reports it (tests, development). */
export async function runPowerAction(action: WhenDoneAction): Promise<string> {
  const c = powerCommand(action);
  if (!c) return 'nothing to run';
  const line = `${c[0]} ${c[1].join(' ')}`;
  if (process.env.GRABBIT_POWER_DRY_RUN === '1') return `dry run: ${line}`;
  const { code, output } = await run(c[0], c[1], 30_000);
  if (code !== 0) throw new Error(`${line} failed: ${lastLines(output) || `exit code ${code}`}`);
  return line;
}
