import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export function newId(): string {
  return randomBytes(8).toString('hex');
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** A name that is safe on Windows, macOS and Linux: no separators, control or reserved characters. */
export function sanitizeFileName(name: string): string {
  let n = name.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_').replace(/^[ .]+|[ .]+$/g, '').trim();
  if (!n) n = 'download';
  if (RESERVED.test(n)) n = `_${n}`;
  if (n.length > 200) {
    const ext = path.extname(n).slice(0, 20);
    n = n.slice(0, 200 - ext.length) + ext;
  }
  return n;
}

/** File name from Content-Disposition (RFC 6266 / 5987), falling back to the last URL path segment. */
export function fileNameFrom(url: string, contentDisposition?: string | null): string {
  if (contentDisposition) {
    const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(contentDisposition);
    if (star) {
      try {
        return sanitizeFileName(decodeURIComponent(star[2].trim().replace(/^"|"$/g, '')));
      } catch {
        /* fall through */
      }
    }
    const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(contentDisposition);
    if (plain) {
      const v = (plain[2] ?? plain[1]).trim();
      if (v) {
        try {
          // Many servers send raw UTF-8 bytes in a latin1 header.
          return sanitizeFileName(Buffer.from(v, 'latin1').toString('utf8'));
        } catch {
          return sanitizeFileName(v);
        }
      }
    }
  }
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop();
    if (last) return sanitizeFileName(decodeURIComponent(last));
    return sanitizeFileName(u.hostname);
  } catch {
    return 'download';
  }
}

/** "file.zip" -> "file (1).zip" -> "file (2).zip" ... until neither the file nor its temp file exists. */
export function uniquePath(dir: string, fileName: string, taken: Set<string> = new Set()): string {
  const ext = path.extname(fileName);
  const base = fileName.slice(0, fileName.length - ext.length);
  for (let i = 0; i < 10000; i++) {
    const name = i === 0 ? fileName : `${base} (${i})${ext}`;
    const full = path.join(dir, name);
    if (!taken.has(full.toLowerCase()) && !fs.existsSync(full) && !fs.existsSync(full + TEMP_EXT)) return full;
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`);
}

export const TEMP_EXT = '.dlpart';

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

let tmpCounter = 0;

/**
 * Write a file atomically: temp file + rename, so a crash never leaves half a JSON document. Each call gets its own temp
 * file, so overlapping writes of the same file cannot rename each other's temp file away.
 */
export async function atomicWrite(file: string, data: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${++tmpCounter}.tmp`;
  await fs.promises.writeFile(tmp, data, 'utf8');
  await fs.promises.rename(tmp, file);
}

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) {
    const code = (e as NodeJS.ErrnoException).code;
    const friendly = code ? NET_ERRORS[code] : undefined;
    return friendly ?? e.message;
  }
  return String(e);
}

const NET_ERRORS: Record<string, string> = {
  ENOTFOUND: 'Server not found (DNS lookup failed)',
  ECONNREFUSED: 'Connection refused by the server',
  ECONNRESET: 'Connection reset by the server',
  ETIMEDOUT: 'Connection timed out',
  EAI_AGAIN: 'DNS lookup timed out',
  ENOSPC: 'Not enough disk space',
  EACCES: 'Permission denied while writing the file',
  EPERM: 'Permission denied while writing the file',
  CERT_HAS_EXPIRED: 'The server certificate has expired',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'The server uses a self-signed certificate',
};
