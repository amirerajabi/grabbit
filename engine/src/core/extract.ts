// Archive extraction with 7-Zip: ZIP, 7z and RAR, including multi-part sets (name.part1.rar, name.r00, name.7z.001,
// name.zip + name.z01) and encrypted archives (no password first, then each saved one).
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ArchiveName {
  /** Identifies the set: parts of one archive share it (lower case, same folder). */
  group: string;
  /** The part 7-Zip opens to extract the whole set. */
  first: boolean;
  /** Folder name for the extracted files. */
  base: string;
}

/** What kind of archive part a file name is, or null when it isn't one Grabbit extracts. */
export function archiveName(fileName: string): ArchiveName | null {
  const n = fileName.toLowerCase();
  let m = /^(.*)\.part(\d+)\.rar$/.exec(n);
  if (m) return { group: `${m[1]}.rar`, first: Number(m[2]) === 1, base: fileName.slice(0, m[1].length) };
  m = /^(.*)\.(7z|zip|rar)\.(\d{3})$/.exec(n);
  if (m) return { group: `${m[1]}.${m[2]}`, first: Number(m[3]) === 1, base: fileName.slice(0, m[1].length) };
  m = /^(.*)\.r(\d{2})$/.exec(n);
  if (m) return { group: `${m[1]}.rar`, first: false, base: fileName.slice(0, m[1].length) };
  m = /^(.*)\.z(\d{2})$/.exec(n);
  if (m) return { group: `${m[1]}.zip`, first: false, base: fileName.slice(0, m[1].length) };
  m = /^(.*)\.(zip|7z|rar)$/.exec(n);
  if (m) return { group: `${m[1]}.${m[2]}`, first: true, base: fileName.slice(0, m[1].length) };
  return null;
}

/** A folder next to the archive that doesn't exist yet: "name", then "name (1)", … */
export function extractDir(dir: string, base: string): string {
  for (let i = 0; i < 10000; i++) {
    const p = path.join(dir, i === 0 ? base : `${base} (${i})`);
    if (!fs.existsSync(p)) return p;
  }
  return path.join(dir, `${base}-${Date.now()}`);
}

export interface ExtractResult {
  result: 'done' | 'password' | 'failed';
  message: string | null;
}

const NO_PASSWORD = 'grabbit-no-password-given';
const PASSWORD_ERROR =/wrong password|can ?not open encrypted archive|data error in encrypted file/i;

/** One 7-Zip run; resolves with its exit code and error output, reporting progress (0-100) on the way. */
function sevenZip(bin: string, args: string[], onProgress: (pct: number) => void): Promise<{ code: number; err: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d: string) => {
      const all = [...d.matchAll(/(\d{1,3})%/g)];
      if (all.length) onProgress(Math.min(100, Number(all[all.length - 1][1])));
    });
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', (d: string) => {
      if (err.length < 8000) err += d;
    });
    p.on('error', reject);
    p.on('close', (code) => resolve({ code: code ?? -1, err }));
  });
}

/**
 * Extracts `archive` into `dest` (created here). Tries no password, then each of `passwords`. 7-Zip already refuses
 * entries that would land outside `dest` ("../", absolute paths).
 */
export async function extractArchive(bin: string, archive: string, dest: string, passwords: string[], onProgress: (pct: number) => void): Promise<ExtractResult> {
  let sawPassword = false;
  // The first try uses a password nobody has: an unencrypted archive ignores it, and a bare -p would make 7-Zip ask
  // for one on a console that isn't there.
  for (const pw of [NO_PASSWORD, ...passwords]) {
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    // -aou renames files that would overwrite each other instead of asking.
    const { code, err } = await sevenZip(bin, ['x', '-y', '-aou', '-bso0', '-bsp1', '-bse2', `-p${pw}`, `-o${dest}`, '--', archive], onProgress);
    if (code === 0) return { result: 'done', message: null };
    if (PASSWORD_ERROR.test(err)) {
      sawPassword = true;
      continue;
    }
    fs.rmSync(dest, { recursive: true, force: true });
    const line = err.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^7-zip|^scanning|^$/i.test(l));
    if (/missing volume|unexpected end of (archive|data)/i.test(err)) return { result: 'failed', message: 'Some parts of the archive are missing or incomplete' };
    return { result: 'failed', message: line.slice(0, 3).join(' ') || `7-Zip stopped with code ${code}` };
  }
  fs.rmSync(dest, { recursive: true, force: true });
  return {
    result: sawPassword ? 'password' : 'failed',
    message: sawPassword ? (passwords.length ? 'None of the saved passwords opens this archive' : 'The archive is password-protected') : null,
  };
}
