import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import type { Duplex } from 'node:stream';
import * as tls from 'node:tls';
import { createHash, randomBytes } from 'node:crypto';
import { proxyAuthHeader, proxyFor, tunnel, type ProxyConfig } from './proxy';

// Keep-alive agents: every segment of a download reuses the same few sockets to the same host.
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 256 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 256 });
/** Plain-HTTP requests through an HTTP proxy go to the proxy itself, so they can share its sockets. */
const proxyAgent = new http.Agent({ keepAlive: true, maxSockets: 256 });

type Callback = (err: Error | null, socket?: net.Socket) => void;

/** One keep-alive agent per proxy and target whose sockets are tunnels through the proxy. */
const tunnelAgents = new Map<string, http.Agent>();

function tunnelAgent(proxy: ProxyConfig, u: URL, isHttps: boolean, timeoutMs: number): http.Agent {
  const host = u.hostname.replace(/^[|]$/g, '');
  const port = Number(u.port) || (isHttps ? 443 : 80);
  const key = `${proxy.protocol}://${proxy.username ?? ''}@${proxy.host}:${proxy.port}|${isHttps ? 's' : ''}${host}:${port}`;
  let agent = tunnelAgents.get(key);
  if (agent) return agent;
  const connect = (cb: Callback) => {
    tunnel(proxy, host, port, timeoutMs).then(
      (sock) => {
        if (!isHttps) return cb(null, sock);
        const t = tls.connect({ socket: sock, servername: net.isIP(host) ? undefined : host, ALPNProtocols: ['http/1.1'], ...(extraCa ? { ca: [...tls.rootCertificates, extraCa] } : {}) });
        t.once('secureConnect', () => cb(null, t));
        t.once('error', (e) => cb(e));
      },
      (e) => cb(e),
    );
  };
  const Base = isHttps ? https.Agent : http.Agent;
  class TunnelAgent extends Base {
    // Async form: return nothing and hand the socket to the callback once the tunnel is up.
    createConnection(_options: http.ClientRequestArgs, cb?: (err: Error | null, stream: Duplex) => void): Duplex | null | undefined {
      if (cb) connect((err, sock) => cb(err, sock as Duplex));
      return undefined;
    }
  }
  agent = new TunnelAgent({ keepAlive: true, maxSockets: 64 }) as http.Agent;
  tunnelAgents.set(key, agent);
  return agent;
}

/** Extra trusted certificate for TLS through proxy tunnels (tests use a self-signed server). */
let extraCa: string | null = null;
export function setExtraCa(pem: string | null): void {
  extraCa = pem;
}

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

/** The server wants a login: none is saved for the site (`failed` false) or the saved one was refused (true). */
export class AuthError extends HttpError {
  constructor(readonly site: string, readonly realm: string | null, readonly failed: boolean) {
    super(401, failed ? `${site} refused the saved username or password` : `${site} needs a username and password`);
  }
}

// ------------------------------------------------------------------ site logins (HTTP Basic and Digest)

type CredentialLookup = (host: string) => { username: string; password: string } | null;
let lookupCredentials: CredentialLookup = () => null;

export function setCredentialLookup(fn: CredentialLookup): void {
  lookupCredentials = fn;
  authCache.clear();
}

interface DigestState {
  scheme: 'digest';
  realm: string;
  nonce: string;
  qop: string | null;
  opaque: string | null;
  algorithm: string;
  nc: number;
}

/**
 * Per origin, how the server last asked to log in: later requests (the other segments) send the answer up front instead
 * of collecting a 401 first.
 */
const authCache = new Map<string, { scheme: 'basic'; realm: string | null } | DigestState>();

function authParams(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of header.matchAll(/(\w+)=(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g)) out[m[1].toLowerCase()] = (m[2] ?? m[3]).replace(/\\(.)/g, '$1');
  return out;
}

/** Digest when the server offers it (it never sends the password), else Basic. */
function parseChallenge(header: string | undefined): { scheme: 'basic'; realm: string | null } | DigestState | null {
  if (!header) return null;
  const digest = /Digest\s+(.*)$/is.exec(header);
  if (digest) {
    const p = authParams(digest[1]);
    if (!p.nonce) return null;
    const qop = p.qop ? (p.qop.split(',').map((q) => q.trim()).includes('auth') ? 'auth' : null) : null;
    return { scheme: 'digest', realm: p.realm ?? '', nonce: p.nonce, qop, opaque: p.opaque ?? null, algorithm: (p.algorithm ?? 'MD5').toUpperCase(), nc: 0 };
  }
  if (/Basic/i.test(header)) return { scheme: 'basic', realm: authParams(header).realm ?? null };
  return null;
}

function authorization(state: { scheme: 'basic'; realm: string | null } | DigestState, creds: { username: string; password: string }, u: URL): string | null {
  if (state.scheme === 'basic') return `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`;
  const algo = state.algorithm.replace('-SESS', '') === 'SHA-256' ? 'sha256' : state.algorithm.startsWith('MD5') ? 'md5' : null;
  if (!algo) return null;
  const H = (x: string) => createHash(algo).update(x).digest('hex');
  const uri = u.pathname + u.search;
  const cnonce = randomBytes(8).toString('hex');
  let ha1 = H(`${creds.username}:${state.realm}:${creds.password}`);
  if (state.algorithm.endsWith('-SESS')) ha1 = H(`${ha1}:${state.nonce}:${cnonce}`);
  const ha2 = H(`GET:${uri}`);
  state.nc++;
  const nc = state.nc.toString(16).padStart(8, '0');
  const response = state.qop ? H(`${ha1}:${state.nonce}:${nc}:${cnonce}:${state.qop}:${ha2}`) : H(`${ha1}:${state.nonce}:${ha2}`);
  const q = (v: string) => `"${v.replace(/(["\\])/g, '\\$1')}"`;
  const parts = [`username=${q(creds.username)}`, `realm=${q(state.realm)}`, `nonce=${q(state.nonce)}`, `uri=${q(uri)}`, `response=${q(response)}`, `algorithm=${state.algorithm}`];
  if (state.qop) parts.push(`qop=${state.qop}`, `nc=${nc}`, `cnonce=${q(cnonce)}`);
  if (state.opaque) parts.push(`opaque=${q(state.opaque)}`);
  return `Digest ${parts.join(', ')}`;
}

/** Credentials typed into the address (https://user:pass@host/…) win over saved ones. */
function credentialsFor(u: URL): { username: string; password: string } | null {
  if (u.username) return { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
  return lookupCredentials(u.hostname);
}

/**
 * GET `url` and resolve once the response headers arrive (redirects followed). The body is left unread: the caller
 * consumes or destroys it. An idle socket for `timeoutMs` (while connecting or while reading the body) fails the request.
 */
export function openRequest(url: string, opts: OpenOptions): Promise<OpenResult> {
  const maxRedirects = opts.maxRedirects ?? 10;
  return new Promise((resolve, reject) => {
    const go = (current: string, hops: number, authTried = false) => {
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
      const creds = credentialsFor(u);
      const known = authCache.get(u.origin);
      if (creds && known) {
        const a = authorization(known, creds, u);
        if (a) headers.Authorization = a;
      }
      // The login goes in the Authorization header, never in the request URL.
      if (u.username) {
        u.username = '';
        u.password = '';
      }
      proxyFor(u).then(
        (proxy) => send(u, current, hops, isHttps, headers, proxy, authTried),
        (e) => reject(e),
      );
    };
    const send = (u: URL, current: string, hops: number, isHttps: boolean, headers: Record<string, string>, proxy: ProxyConfig | null, authTried: boolean) => {
      let req: http.ClientRequest;
      if (!proxy) {
        req = (isHttps ? https : http).request(u, { method: 'GET', headers, agent: isHttps ? httpsAgent : httpAgent, signal: opts.signal });
      } else if (proxy.protocol === 'http' && !isHttps) {
        // Plain HTTP through an HTTP proxy: ask the proxy for the absolute URL.
        const auth = proxyAuthHeader(proxy);
        req = http.request({
          host: proxy.host,
          port: proxy.port,
          path: u.href,
          method: 'GET',
          headers: { ...headers, Host: u.host, ...(auth ? { 'Proxy-Authorization': auth } : {}) },
          agent: proxyAgent,
          signal: opts.signal,
        });
      } else {
        // HTTPS through any proxy, or anything through SOCKS: each connection is a tunnel to the target (TLS inside it
        // for https), made by an agent that keeps those tunnels alive for the next segment.
        req = (isHttps ? https : http).request(u, { method: 'GET', headers, agent: tunnelAgent(proxy, u, isHttps, opts.timeoutMs), signal: opts.signal });
      }
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
        if (status === 401) {
          res.resume();
          const challenge = parseChallenge(res.headers['www-authenticate']);
          const creds = credentialsFor(new URL(current));
          const realm = challenge && 'realm' in challenge ? challenge.realm || null : null;
          // One retry with the login (or with a fresh Digest nonce); a second 401 means the login is wrong.
          if (challenge && creds && !authTried) {
            authCache.set(u.origin, challenge);
            go(current, hops, true);
            return;
          }
          authCache.delete(u.origin);
          reject(new AuthError(u.hostname, realm, !!creds));
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
