import * as http from 'node:http';
import * as https from 'node:https';

// Keep-alive agents: every segment of a download reuses the same few sockets to the same host.
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 256 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 256 });

export interface OpenOptions {
  headers: Record<string, string>;
  /** Inclusive byte range; end undefined = to the end of the file. */
  range?: { start: number; end?: number };
  timeoutMs: number;
  signal?: AbortSignal;
  maxRedirects?: number;
}

export interface OpenResult {
  res: http.IncomingMessage;
  finalUrl: string;
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
  /** 4xx (except throttling) never gets better by retrying. */
  get permanent(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429;
  }
}

/**
 * GET `url` and resolve once the response headers arrive (redirects followed). The body is left unread: the caller
 * consumes or destroys it. An idle socket for `timeoutMs` (while connecting or while reading the body) fails the request.
 */
export function openRequest(url: string, opts: OpenOptions): Promise<OpenResult> {
  const maxRedirects = opts.maxRedirects ?? 10;
  return new Promise((resolve, reject) => {
    const go = (current: string, hops: number) => {
      let u: URL;
      try {
        u = new URL(current);
      } catch {
        reject(new Error(`Invalid URL: ${current}`));
        return;
      }
      const isHttps = u.protocol === 'https:';
      if (!isHttps && u.protocol !== 'http:') {
        reject(new Error(`Unsupported protocol: ${u.protocol}`));
        return;
      }
      const headers: Record<string, string> = { Accept: '*/*', 'Accept-Encoding': 'identity', ...opts.headers };
      if (opts.range) headers.Range = `bytes=${opts.range.start}-${opts.range.end ?? ''}`;
      const req = (isHttps ? https : http).request(u, {
        method: 'GET',
        headers,
        agent: isHttps ? httpsAgent : httpAgent,
        signal: opts.signal,
      });
      req.setTimeout(opts.timeoutMs, () => {
        const err = new Error('Connection timed out') as NodeJS.ErrnoException;
        err.code = 'ETIMEDOUT';
        req.destroy(err);
      });
      req.on('error', reject);
      req.on('response', (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (hops >= maxRedirects) {
            reject(new Error('Too many redirects'));
            return;
          }
          go(new URL(res.headers.location, current).toString(), hops + 1);
          return;
        }
        if (status >= 400) {
          res.resume();
          reject(new HttpError(status, `Server responded ${status} ${res.statusMessage ?? ''}`.trim()));
          return;
        }
        resolve({ res, finalUrl: current });
      });
      req.end();
    };
    go(url, 0);
  });
}

/** Total size from "Content-Range: bytes 0-99/1234", null when the server sends "*". */
export function totalFromContentRange(v: string | undefined): number | null {
  if (!v) return null;
  const m = /\/(\d+)\s*$/.exec(v);
  return m ? Number(m[1]) : null;
}

/** Start offset from "Content-Range: bytes 100-199/1234". */
export function startFromContentRange(v: string | undefined): number | null {
  if (!v) return null;
  const m = /bytes\s+(\d+)-/.exec(v);
  return m ? Number(m[1]) : null;
}
