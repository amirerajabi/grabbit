// Proxy support for every outgoing connection: HTTP proxies (plain requests by absolute URI, HTTPS through a CONNECT
// tunnel) and SOCKS5 (with optional username/password, and remote DNS so the proxy resolves names). The mode comes from
// the settings: none, the system proxy (read from the OS), or a manual proxy URL, plus a bypass list.
import { execFile } from 'node:child_process';
import * as net from 'node:net';

export interface ProxyConfig {
  protocol: 'http' | 'socks5';
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface ProxySettings {
  mode: 'none' | 'system' | 'manual';
  url: string;
  /** Hosts that never use the proxy: exact names, ".suffix" / "*.suffix", or "<local>" for names without a dot. */
  bypass: string[];
}

/** "http://user:pass@host:port", "socks5://host:1080", "socks5h://…" or plain "host:port" (HTTP). */
export function parseProxyUrl(text: string): ProxyConfig | null {
  const t = text.trim();
  if (!t) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `http://${t}`);
  } catch {
    return null;
  }
  const scheme = u.protocol.replace(':', '').toLowerCase();
  const protocol = scheme === 'http' || scheme === 'https' ? 'http' : scheme === 'socks5' || scheme === 'socks5h' || scheme === 'socks' ? 'socks5' : null;
  if (!protocol || !u.hostname) return null;
  const port = Number(u.port) || (protocol === 'socks5' ? 1080 : 8080);
  const cfg: ProxyConfig = { protocol, host: u.hostname.replace(/^\[|\]$/g, ''), port };
  if (u.username) cfg.username = decodeURIComponent(u.username);
  if (u.password) cfg.password = decodeURIComponent(u.password);
  return cfg;
}

function bypassed(host: string, rules: string[]): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  for (const raw of rules) {
    const r = raw.trim().toLowerCase();
    if (!r) continue;
    if (r === '<local>') {
      if (!h.includes('.') && !h.includes(':')) return true;
      continue;
    }
    const suffix = r.startsWith('*.') ? r.slice(1) : r.startsWith('.') ? r : null;
    if (suffix ? h.endsWith(suffix) || h === suffix.slice(1) : h === r) return true;
  }
  return false;
}

// ------------------------------------------------------------------ system proxy

interface SystemProxy {
  http: ProxyConfig | null;
  https: ProxyConfig | null;
  bypass: string[];
}

let system: SystemProxy = { http: null, https: null, bypass: [] };
let systemReadAt = 0;

function exec(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout: 5000 }, (_e, out) => resolve(String(out ?? ''))));
}

/** Windows: "host:port", or per scheme "http=host:port;https=host:port;socks=host:port". */
export function parseWindowsProxy(server: string, override: string): SystemProxy {
  const out: SystemProxy = { http: null, https: null, bypass: override.split(';').map((s) => s.trim()).filter(Boolean) };
  if (!server.includes('=')) {
    const p = parseProxyUrl(server);
    return { ...out, http: p, https: p };
  }
  for (const part of server.split(';')) {
    const [k, v] = part.split('=');
    if (!v) continue;
    const key = k.trim().toLowerCase();
    if (key === 'socks') {
      const p = parseProxyUrl(`socks5://${v.trim()}`);
      out.http ??= p;
      out.https ??= p;
    } else if (key === 'http') {
      out.http = parseProxyUrl(v.trim());
    } else if (key === 'https') {
      out.https = parseProxyUrl(v.trim());
    }
  }
  return out;
}

/** macOS `scutil --proxy` output (HTTPEnable, HTTPProxy, HTTPPort, HTTPS…, SOCKS…, ExceptionsList). */
export function parseScutil(text: string): SystemProxy {
  const val = (k: string) => new RegExp(`^\\s*${k}\\s*:\\s*(.+)$`, 'm').exec(text)?.[1]?.trim();
  const pick = (prefix: string, protocol: 'http' | 'socks5'): ProxyConfig | null =>
    val(`${prefix}Enable`) === '1' && val(`${prefix}Proxy`) ? { protocol, host: val(`${prefix}Proxy`)!, port: Number(val(`${prefix}Port`)) || 8080 } : null;
  const socks = pick('SOCKS', 'socks5');
  const exceptions = /ExceptionsList\s*:\s*<array>\s*\{([^}]*)\}/m.exec(text)?.[1] ?? '';
  return {
    http: pick('HTTP', 'http') ?? socks,
    https: pick('HTTPS', 'http') ?? socks,
    bypass: [...exceptions.matchAll(/\d+\s*:\s*(\S+)/g)].map((m) => m[1]),
  };
}

async function readSystemProxy(): Promise<SystemProxy> {
  if (process.platform === 'win32') {
    const out = await exec('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings']);
    const get = (name: string) => new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.*)$`, 'mi').exec(out)?.[1]?.trim() ?? '';
    if (!/^0x0*1$/i.test(get('ProxyEnable'))) return { http: null, https: null, bypass: [] };
    return parseWindowsProxy(get('ProxyServer'), get('ProxyOverride'));
  }
  if (process.platform === 'darwin') return parseScutil(await exec('scutil', ['--proxy']));
  const env = process.env;
  const all = env.ALL_PROXY ?? env.all_proxy ?? '';
  return {
    http: parseProxyUrl(env.HTTP_PROXY ?? env.http_proxy ?? all),
    https: parseProxyUrl(env.HTTPS_PROXY ?? env.https_proxy ?? all),
    bypass: (env.NO_PROXY ?? env.no_proxy ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

/** Re-read the OS proxy at most once a minute; a change in Windows' proxy settings is picked up without a restart. */
async function refreshSystem(): Promise<void> {
  if (Date.now() - systemReadAt < 60_000) return;
  systemReadAt = Date.now();
  system = await readSystemProxy().catch(() => system);
}

// ------------------------------------------------------------------ resolution

let settings: ProxySettings = { mode: 'none', url: '', bypass: [] };

export function setProxySettings(s: ProxySettings): void {
  settings = s;
  systemReadAt = 0;
  if (s.mode === 'system') void refreshSystem();
}

/** The proxy for a target URL, or null to connect directly. */
export async function proxyFor(target: URL): Promise<ProxyConfig | null> {
  if (settings.mode === 'none') return null;
  if (settings.mode === 'manual') {
    const p = parseProxyUrl(settings.url);
    return p && !bypassed(target.hostname, settings.bypass) ? p : null;
  }
  await refreshSystem();
  const p = target.protocol === 'https:' ? system.https : system.http;
  return p && !bypassed(target.hostname, [...system.bypass, ...settings.bypass]) ? p : null;
}

/** The proxy for tools that take a URL (yt-dlp's --proxy), or null. */
export async function proxyUrlFor(target: URL): Promise<string | null> {
  const p = await proxyFor(target);
  if (!p) return null;
  const auth = p.username ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password ?? '')}@` : '';
  return `${p.protocol === 'socks5' ? 'socks5h' : 'http'}://${auth}${p.host}:${p.port}`;
}

export function proxyAuthHeader(p: ProxyConfig): string | null {
  return p.username ? `Basic ${Buffer.from(`${p.username}:${p.password ?? ''}`).toString('base64')}` : null;
}

// ------------------------------------------------------------------ tunnels

/** A raw TCP connection to host:port through the proxy (CONNECT for HTTP proxies, a SOCKS5 handshake otherwise). */
export function tunnel(p: ProxyConfig, host: string, port: number, timeoutMs: number, signal?: AbortSignal): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(p.port, p.host);
    let done = false;
    const fail = (e: Error) => {
      if (done) return;
      done = true;
      sock.destroy();
      reject(e);
    };
    const ok = () => {
      if (done) return;
      done = true;
      sock.setTimeout(0);
      signal?.removeEventListener('abort', onAbort);
      resolve(sock);
    };
    const onAbort = () => fail(signal?.reason instanceof Error ? signal.reason : new Error('Aborted'));
    signal?.addEventListener('abort', onAbort, { once: true });
    sock.setTimeout(timeoutMs, () => fail(Object.assign(new Error('The proxy did not answer in time'), { code: 'ETIMEDOUT' })));
    sock.on('error', (e) => fail(new Error(`Proxy ${p.host}:${p.port}: ${e.message}`)));
    sock.once('connect', () => (p.protocol === 'http' ? httpConnect(p, sock, host, port, ok, fail) : socks5(p, sock, host, port, ok, fail)));
  });
}

function httpConnect(p: ProxyConfig, sock: net.Socket, host: string, port: number, ok: () => void, fail: (e: Error) => void): void {
  const target = host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
  const auth = proxyAuthHeader(p);
  sock.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${auth ? `Proxy-Authorization: ${auth}\r\n` : ''}\r\n`);
  let buf = Buffer.alloc(0);
  const onData = (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
    const end = buf.indexOf('\r\n\r\n');
    if (end < 0) {
      if (buf.length > 16384) fail(new Error('The proxy sent an invalid answer'));
      return;
    }
    sock.off('data', onData);
    const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(buf.toString('latin1'))?.[1]);
    if (status === 200) {
      const rest = buf.subarray(end + 4);
      if (rest.length) sock.unshift(rest);
      ok();
    } else {
      fail(new Error(status === 407 ? 'The proxy needs a username and password' : `The proxy refused the connection (${status || 'no status'})`));
    }
  };
  sock.on('data', onData);
}

const SOCKS_ERRORS: Record<number, string> = {
  1: 'general failure', 2: 'not allowed by the proxy rules', 3: 'network unreachable', 4: 'host unreachable',
  5: 'connection refused', 6: 'TTL expired', 7: 'command not supported', 8: 'address type not supported',
};

function socks5(p: ProxyConfig, sock: net.Socket, host: string, port: number, ok: () => void, fail: (e: Error) => void): void {
  let buf = Buffer.alloc(0);
  let stage: 'method' | 'auth' | 'connect' = 'method';
  const want = (n: number) => (buf.length >= n ? buf : null);
  const take = (n: number) => {
    const b = buf.subarray(0, n);
    buf = buf.subarray(n);
    return b;
  };
  const sendConnect = () => {
    const name = Buffer.from(host);
    const req = Buffer.concat([Buffer.from([5, 1, 0, 3, name.length]), name, Buffer.from([port >> 8, port & 0xff])]);
    stage = 'connect';
    sock.write(req);
  };
  const onData = (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
    if (stage === 'method') {
      if (!want(2)) return;
      const [ver, method] = take(2);
      if (ver !== 5) return fail(new Error('Not a SOCKS5 proxy'));
      if (method === 0) return sendConnect();
      if (method === 2 && p.username) {
        const u = Buffer.from(p.username);
        const pw = Buffer.from(p.password ?? '');
        stage = 'auth';
        sock.write(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([pw.length]), pw]));
        return;
      }
      return fail(new Error(method === 2 ? 'The proxy needs a username and password' : 'The proxy accepts no login method Grabbit supports'));
    }
    if (stage === 'auth') {
      if (!want(2)) return;
      const [, status] = take(2);
      if (status !== 0) return fail(new Error('The proxy refused the username or password'));
      return sendConnect();
    }
    // connect reply: VER REP RSV ATYP BND.ADDR BND.PORT
    if (!want(5)) return;
    const atyp = buf[3];
    const len = atyp === 1 ? 4 : atyp === 4 ? 16 : buf[4] + 1;
    if (!want(4 + len + 2)) return;
    const reply = take(4 + len + 2);
    sock.off('data', onData);
    if (reply[1] !== 0) return fail(new Error(`The proxy could not connect: ${SOCKS_ERRORS[reply[1]] ?? `error ${reply[1]}`}`));
    if (buf.length) sock.unshift(buf);
    ok();
  };
  sock.on('data', onData);
  sock.write(Buffer.from(p.username ? [5, 2, 0, 2] : [5, 1, 0]));
}
