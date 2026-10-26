// Where a download's bytes come from: HTTP(S), FTP or SFTP behind one interface, so segmentation, resume, retries and the
// speed limit work the same for all of them.
import type { Readable } from 'node:stream';
import type { DownloadItem, Settings } from '../../../../shared/protocol';
import { categoryFor } from '../categories';
import { credentialsFor, HttpError, openRequest, startFromContentRange, totalFromContentRange } from '../http';
import { fileNameFrom } from '../util';
import { ftpOpen, ftpProbe } from './ftp';
import { sftpOpen, sftpProbe } from './sftp';

export interface ProbeInfo {
  finalUrl: string;
  fileName: string;
  size: number | null;
  resumable: boolean;
  mime: string | null;
}

/** The server doesn't (or no longer does) honour byte ranges: download with one connection from the start. */
export class NoRangeError extends Error {}

export interface Source {
  probe(signal?: AbortSignal): Promise<ProbeInfo>;
  /** Bytes start..end (inclusive) of a file of `size` bytes; the caller stops reading at `end`. */
  openRange(start: number, end: number, size: number, signal: AbortSignal): Promise<Readable>;
  /** The whole file from byte 0, with its length when the server says. */
  openAll(signal: AbortSignal): Promise<{ stream: Readable; length: number | null }>;
}

export type Protocol = 'http' | 'ftp' | 'sftp';

export function protocolOf(url: string): Protocol | null {
  try {
    const p = new URL(url).protocol;
    return p === 'http:' || p === 'https:' ? 'http' : p === 'ftp:' ? 'ftp' : p === 'sftp:' ? 'sftp' : null;
  } catch {
    return null;
  }
}

export function isSupportedUrl(url: string): boolean {
  return protocolOf(url.trim()) !== null;
}

export function requestHeaders(item: Pick<DownloadItem, 'headers' | 'referer'>, settings: Settings): Record<string, string> {
  const h: Record<string, string> = { 'User-Agent': settings.userAgent, ...item.headers };
  if (item.referer) h.Referer = item.referer;
  return h;
}

/** Ask the server about `url` with a ranged GET (more reliable than HEAD) and drop the body. */
export async function probeHttp(url: string, headers: Record<string, string>, timeoutMs: number, signal?: AbortSignal): Promise<ProbeInfo> {
  const { res, finalUrl } = await openRequest(url, { headers, range: { start: 0 }, timeoutMs, signal });
  try {
    const status = res.statusCode ?? 0;
    const length = res.headers['content-length'] ? Number(res.headers['content-length']) : null;
    const total = totalFromContentRange(res.headers['content-range']);
    const resumable = status === 206 && total !== null;
    const size = resumable ? total : Number.isFinite(length) ? length : null;
    const mime = (res.headers['content-type'] ?? '').split(';')[0].trim() || null;
    return { finalUrl, fileName: fileNameFrom(finalUrl, res.headers['content-disposition']), size, resumable, mime };
  } finally {
    res.destroy();
  }
}

/** The source for a download (or for a bare URL in the Add dialog). */
export function sourceFor(item: Pick<DownloadItem, 'url' | 'finalUrl' | 'headers' | 'referer'>, settings: Settings): Source {
  const timeoutMs = settings.timeoutSec * 1000;
  const protocol = protocolOf(item.url);
  if (protocol === 'ftp' || protocol === 'sftp') {
    const u = new URL(item.url);
    const creds = () => credentialsFor(u);
    const fileName = fileNameFrom(item.url);
    const probe = protocol === 'ftp' ? ftpProbe : sftpProbe;
    const open = (start: number, end: number | undefined, signal: AbortSignal) =>
      protocol === 'ftp' ? ftpOpen(u, creds(), start, timeoutMs, signal) : sftpOpen(u, creds(), start, end, timeoutMs, signal);
    return {
      async probe(signal) {
        const p = await probe(u, creds(), timeoutMs, signal);
        return { finalUrl: item.url, fileName, mime: null, ...p };
      },
      openRange: (start, end, _size, signal) => open(start, end, signal),
      async openAll(signal) {
        return { stream: await open(0, undefined, signal), length: null };
      },
    };
  }
  if (protocol !== 'http') throw new Error('Grabbit downloads http, https, ftp and sftp addresses');
  const headers = () => requestHeaders(item, settings);
  return {
    probe: (signal) => probeHttp(item.url, headers(), timeoutMs, signal),
    async openRange(start, end, size, signal) {
      const { res } = await openRequest(item.finalUrl ?? item.url, { headers: headers(), range: { start, end }, timeoutMs, signal });
      if (res.statusCode !== 206) {
        res.destroy();
        throw new NoRangeError('The server ignored the byte range');
      }
      const total = totalFromContentRange(res.headers['content-range']);
      if (startFromContentRange(res.headers['content-range']) !== start || (total !== null && total !== size)) {
        res.destroy();
        throw new HttpError(412, 'The file on the server has changed');
      }
      return res;
    },
    async openAll(signal) {
      const { res } = await openRequest(item.finalUrl ?? item.url, { headers: headers(), timeoutMs, signal });
      const length = res.headers['content-length'] ? Number(res.headers['content-length']) : null;
      return { stream: res, length: length !== null && Number.isFinite(length) ? length : null };
    },
  };
}

/** Probe any supported address, for the Add dialog. */
export async function probeAny(url: string, settings: Settings, extra: { headers?: Record<string, string>; referer?: string | null } = {}) {
  const info = await sourceFor({ url, finalUrl: null, headers: extra.headers ?? {}, referer: extra.referer ?? null }, settings).probe();
  return { ...info, category: categoryFor(info.fileName, info.mime) };
}
