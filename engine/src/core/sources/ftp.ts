// A minimal FTP client for downloads: login (or anonymous), binary mode, SIZE, passive data connections (EPSV, then
// PASV), and REST for resuming and for segments (each segment is its own control connection). Through a proxy, control
// and data connections are tunnels (SOCKS5, or CONNECT on HTTP proxies that allow it). Plain FTP only: ftps:// is not
// supported.
import * as net from 'node:net';
import { Readable } from 'node:stream';
import { AuthError, HttpError } from '../http';
import { proxyFor, tunnel } from '../proxy';

type Login = { username: string; password: string } | null;

class FtpReply {
  constructor(readonly code: number, readonly text: string) {}
}

/** Reads replies line by line, joining multi-line ones ("150-…" up to "150 …"). */
class Control {
  private buf = '';
  private waiters: ((r: FtpReply | Error) => void)[] = [];
  private queue: FtpReply[] = [];
  private multi: { code: string; lines: string[] } | null = null;
  private dead: Error | null = null;

  constructor(readonly sock: net.Socket) {
    sock.setEncoding('utf8');
    sock.on('data', (d: string) => this.feed(d));
    const die = (e: Error) => {
      this.dead ??= e;
      for (const w of this.waiters.splice(0)) w(this.dead);
    };
    sock.on('error', (e) => die(e));
    sock.on('close', () => die(new Error('The FTP server closed the connection')));
  }

  private feed(d: string): void {
    this.buf += d;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, '');
      this.buf = this.buf.slice(i + 1);
      const m = /^(\d{3})([ -])(.*)$/.exec(line);
      if (this.multi) {
        this.multi.lines.push(line);
        if (m && m[1] === this.multi.code && m[2] === ' ') {
          this.push(new FtpReply(Number(m[1]), this.multi.lines.join('\n')));
          this.multi = null;
        }
      } else if (m && m[2] === '-') {
        this.multi = { code: m[1], lines: [m[3]] };
      } else if (m) {
        this.push(new FtpReply(Number(m[1]), m[3]));
      }
    }
  }

  private push(r: FtpReply): void {
    const w = this.waiters.shift();
    if (w) w(r);
    else this.queue.push(r);
  }

  read(): Promise<FtpReply> {
    const q = this.queue.shift();
    if (q) return Promise.resolve(q);
    if (this.dead) return Promise.reject(this.dead);
    return new Promise((resolve, reject) => this.waiters.push((r) => (r instanceof Error ? reject(r) : resolve(r))));
  }

  async send(cmd: string): Promise<FtpReply> {
    if (/[\r\n]/.test(cmd)) throw new Error('Invalid FTP command');
    this.sock.write(`${cmd}\r\n`);
    return this.read();
  }

  close(): void {
    if (!this.sock.destroyed) {
      this.sock.end('QUIT\r\n');
      setTimeout(() => this.sock.destroy(), 1000).unref();
    }
  }
}

function connectTo(u: URL, host: string, port: number, timeoutMs: number, signal?: AbortSignal): Promise<net.Socket> {
  return proxyFor(u).then((proxy) => {
    if (proxy) return tunnel(proxy, host, port, timeoutMs, signal);
    return new Promise<net.Socket>((resolve, reject) => {
      const s = net.connect(port, host);
      const t = setTimeout(() => s.destroy(Object.assign(new Error('Connection timed out'), { code: 'ETIMEDOUT' })), timeoutMs);
      s.once('connect', () => {
        clearTimeout(t);
        resolve(s);
      });
      s.once('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
    });
  });
}

const want = (r: FtpReply, ...codes: number[]) => {
  if (!codes.includes(r.code)) throw new HttpError(r.code >= 500 ? 404 : 503, `FTP server: ${r.code} ${r.text}`);
  return r;
};

export interface FtpSession {
  control: Control;
  size: number | null;
  resumable: boolean;
}

/** Connect and log in; with no saved login, anonymous. */
async function login(u: URL, creds: Login, timeoutMs: number, signal?: AbortSignal): Promise<Control> {
  const port = Number(u.port) || 21;
  const control = new Control(await connectTo(u, u.hostname, port, timeoutMs, signal));
  control.sock.setTimeout(timeoutMs, () => control.sock.destroy(Object.assign(new Error('The FTP server stopped answering'), { code: 'ETIMEDOUT' })));
  try {
    want(await control.read(), 220);
    const user = creds?.username ?? 'anonymous';
    const pass = creds?.password ?? 'anonymous@';
    let r = await control.send(`USER ${user}`);
    if (r.code === 331) r = await control.send(`PASS ${pass}`);
    if (r.code === 530 || r.code === 430) throw new AuthError(u.hostname, null, !!creds);
    want(r, 230, 202);
    want(await control.send('TYPE I'), 200);
    return control;
  } catch (e) {
    control.close();
    throw e;
  }
}

export function ftpPath(u: URL): string {
  return decodeURIComponent(u.pathname) || '/';
}

/** Size and resume support for a file: SIZE, and whether REST is accepted. */
export async function ftpProbe(u: URL, creds: Login, timeoutMs: number, signal?: AbortSignal): Promise<{ size: number | null; resumable: boolean }> {
  const control = await login(u, creds, timeoutMs, signal);
  try {
    const s = await control.send(`SIZE ${ftpPath(u)}`);
    if (s.code === 550) throw new HttpError(404, `The file is not on the FTP server (${s.text})`);
    const size = s.code === 213 ? Number(s.text.trim()) : null;
    const rest = await control.send('REST 0');
    return { size: Number.isFinite(size) ? size : null, resumable: rest.code === 350 };
  } finally {
    control.close();
  }
}

/** Opens a passive data connection: EPSV, or PASV for older servers (the data host is always the control host). */
async function passive(u: URL, control: Control, timeoutMs: number, signal?: AbortSignal): Promise<() => Promise<net.Socket>> {
  let r = await control.send('EPSV');
  let port: number | null = null;
  if (r.code === 229) port = Number(/\|\|\|(\d+)\|/.exec(r.text)?.[1]);
  if (!port) {
    r = want(await control.send('PASV'), 227);
    const n = /(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/.exec(r.text);
    if (!n) throw new Error(`FTP server: unexpected PASV reply ${r.text}`);
    port = Number(n[5]) * 256 + Number(n[6]);
  }
  const p = port;
  return () => connectTo(u, u.hostname, p, timeoutMs, signal);
}

/**
 * The bytes from `start` (to the end, or to `end` inclusive: the caller stops reading there). Closing the stream closes
 * both connections.
 */
export async function ftpOpen(u: URL, creds: Login, start: number, timeoutMs: number, signal?: AbortSignal): Promise<Readable> {
  const control = await login(u, creds, timeoutMs, signal);
  try {
    const connect = await passive(u, control, timeoutMs, signal);
    if (start > 0) want(await control.send(`REST ${start}`), 350);
    const dataP = connect();
    // If RETR fails, close the data connection that was already opening.
    dataP.catch(() => undefined);
    const r = await control.send(`RETR ${ftpPath(u)}`).catch((e) => {
      void dataP.then((s) => s.destroy(), () => undefined);
      throw e;
    });
    if (r.code !== 150 && r.code !== 125) void dataP.then((s) => s.destroy(), () => undefined);
    if (r.code === 550) throw new HttpError(404, `The file is not on the FTP server (${r.text})`);
    want(r, 150, 125);
    const data = await dataP;
    control.sock.setTimeout(0);
    data.setTimeout(timeoutMs, () => data.destroy(Object.assign(new Error('The FTP transfer stalled'), { code: 'ETIMEDOUT' })));
    const out = Readable.from(data);
    const stop = () => out.destroy(Object.assign(new Error('Stopped'), { name: 'AbortError' }));
    signal?.addEventListener('abort', stop, { once: true });
    out.on('close', () => {
      signal?.removeEventListener('abort', stop);
      data.destroy();
      control.close();
    });
    if (signal?.aborted) stop();
    return out;
  } catch (e) {
    control.close();
    throw e;
  }
}
