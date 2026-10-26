// Downloads through real local proxies: an HTTP proxy (absolute-URI requests and CONNECT tunnels, with a login) and a
// SOCKS5 proxy (username/password, remote DNS). The HTTPS case needs openssl for a throwaway certificate and is
// skipped without it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, test } from 'node:test';
import type { DownloadItem } from '../../shared/protocol';
import { DownloadManager } from '../src/core/DownloadManager';
import { setExtraCa } from '../src/core/http';
import { parseProxyUrl, parseScutil, parseWindowsProxy, setProxySettings } from '../src/core/proxy';

const SIZE = 3 * 1024 * 1024 + 7;
const payload = randomBytes(SIZE);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const servers: (net.Server | http.Server)[] = [];
const seen = { http: 0, connect: 0, socks: 0 };
let fileBase = '';
let httpsBase = '';
let httpProxy = '';
let socksProxy = '';

/** Range-capable file handler, shared by the HTTP and HTTPS file servers. */
function serveFile(req: http.IncomingMessage, res: http.ServerResponse): void {
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
  const start = m ? Number(m[1]) : 0;
  const end = m && m[2] ? Number(m[2]) : SIZE - 1;
  res.writeHead(m ? 206 : 200, { 'Content-Length': end - start + 1, ...(m ? { 'Content-Range': `bytes ${start}-${end}/${SIZE}` } : {}) });
  res.end(payload.subarray(start, end + 1));
}

const listen = (s: net.Server | http.Server) =>
  new Promise<number>((r) => {
    servers.push(s);
    s.listen(0, '127.0.0.1', () => r((s.address() as net.AddressInfo).port));
  });

before(async () => {
  fileBase = `http://127.0.0.1:${await listen(http.createServer(serveFile))}`;

  // HTTP proxy with a required login.
  const PROXY_AUTH = `Basic ${Buffer.from('alice:s3cret').toString('base64')}`;
  const hp = http.createServer((req, res) => {
    if (req.headers['proxy-authorization'] !== PROXY_AUTH) return void res.writeHead(407, { 'Proxy-Authenticate': 'Basic' }).end();
    seen.http++;
    const target = new URL(req.url!);
    const fwd = { ...req.headers };
    delete fwd['proxy-authorization'];
    const up = http.request(target, { method: req.method, headers: fwd }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on('error', () => res.writeHead(502).end());
    up.end();
  });
  hp.on('connect', (req, sock, head) => {
    if (req.headers['proxy-authorization'] !== PROXY_AUTH) return void sock.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
    seen.connect++;
    const [host, port] = req.url!.split(':');
    const up = net.connect(Number(port), host, () => {
      sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) up.write(head);
      up.pipe(sock).pipe(up);
    });
    up.on('error', () => sock.destroy());
    sock.on('error', () => up.destroy());
  });
  httpProxy = `http://alice:s3cret@127.0.0.1:${await listen(hp)}`;

  // SOCKS5 proxy with username/password, resolving names itself.
  const sp = net.createServer((sock) => {
    let stage = 0;
    sock.on('error', () => undefined);
    sock.on('data', function onData(d) {
      if (stage === 0) {
        stage = 1;
        return void sock.write(Buffer.from([5, 2]));
      }
      if (stage === 1) {
        const u = d.subarray(2, 2 + d[1]).toString();
        const p = d.subarray(3 + d[1], 3 + d[1] + d[2 + d[1]]).toString();
        const ok = u === 'bob' && p === 'pw';
        sock.write(Buffer.from([1, ok ? 0 : 1]));
        if (!ok) sock.end();
        stage = 2;
        return;
      }
      sock.off('data', onData);
      assert.equal(d[3], 3, 'domain-name address (remote DNS)');
      const host = d.subarray(5, 5 + d[4]).toString();
      const port = d.readUInt16BE(5 + d[4]);
      seen.socks++;
      const up = net.connect(port, host === 'localhost' ? '127.0.0.1' : host, () => {
        sock.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
        up.pipe(sock).pipe(up);
      });
      up.on('error', () => sock.destroy());
    });
  });
  socksProxy = `socks5://bob:pw@127.0.0.1:${await listen(sp)}`;

  // HTTPS file server with a throwaway self-signed certificate, if openssl is around.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grabbit-tls-'));
  const r = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem')], { stdio: 'ignore' });
  if (r.status === 0) {
    const cert = fs.readFileSync(path.join(dir, 'c.pem'), 'utf8');
    setExtraCa(cert);
    httpsBase = `https://localhost:${await listen(https.createServer({ key: fs.readFileSync(path.join(dir, 'k.pem')), cert }, serveFile))}`;
  }
});

after(() => {
  for (const s of servers) {
    (s as http.Server).closeAllConnections?.();
    s.close();
  }
  setProxySettings({ mode: 'none', url: '', bypass: [] });
  setExtraCa(null);
});

function makeManager(proxyUrl: string): DownloadManager {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grabbit-proxy-'));
  const m = new DownloadManager(path.join(dir, 'data'));
  m.load();
  // The defaults bypass localhost; clear that so the local test servers go through the proxy.
  m.updateSettings({ downloadDir: path.join(dir, 'out'), retryDelaySec: 1, maxRetries: 2, proxyMode: 'manual', proxyUrl, proxyBypass: [] });
  return m;
}

function done(m: DownloadManager, id: string): Promise<DownloadItem> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout: ${m.get(id)?.status} ${m.get(id)?.error}`)), 20000);
    const check = () => {
      const d = m.get(id);
      if (d && (d.status === 'completed' || d.status === 'error')) {
        clearTimeout(t);
        m.off('event', check);
        resolve(d);
      }
    };
    m.on('event', check);
    check();
  });
}

async function fetchVia(proxyUrl: string, url: string): Promise<DownloadItem> {
  const m = makeManager(proxyUrl);
  const d = await done(m, m.add({ url, start: 'now', connections: 4 }).id);
  await m.shutdown();
  return d;
}

test('plain HTTP through an HTTP proxy with a login', async () => {
  seen.http = 0;
  const d = await fetchVia(httpProxy, `${fileBase.replace('127.0.0.1', 'localhost')}/a.bin`);
  assert.equal(d.status, 'completed', d.error ?? '');
  assert.equal(sha(fs.readFileSync(path.join(d.dir, d.fileName))), sha(payload));
  assert.ok(seen.http >= 2, `the proxy carried the probe and the segments (${seen.http} requests)`);
});

test('a wrong proxy password fails with a clear message', async () => {
  const d = await fetchVia(httpProxy.replace('s3cret', 'nope'), `${fileBase.replace('127.0.0.1', 'localhost')}/a.bin`);
  assert.equal(d.status, 'error');
  assert.match(d.error ?? '', /407/);
});

test('HTTPS through an HTTP proxy (CONNECT tunnel)', async (t) => {
  if (!httpsBase) return t.skip('openssl not found');
  seen.connect = 0;
  const d = await fetchVia(httpProxy, `${httpsBase}/b.bin`);
  assert.equal(d.status, 'completed', d.error ?? '');
  assert.equal(sha(fs.readFileSync(path.join(d.dir, d.fileName))), sha(payload));
  assert.ok(seen.connect >= 2, `tunnels opened: ${seen.connect}`);
});

test('HTTP and HTTPS through SOCKS5 with a login and remote DNS', async () => {
  seen.socks = 0;
  const a = await fetchVia(socksProxy, `${fileBase.replace('127.0.0.1', 'localhost')}/c.bin`);
  assert.equal(a.status, 'completed', a.error ?? '');
  assert.equal(sha(fs.readFileSync(path.join(a.dir, a.fileName))), sha(payload));
  if (httpsBase) {
    const b = await fetchVia(socksProxy, `${httpsBase}/d.bin`);
    assert.equal(b.status, 'completed', b.error ?? '');
    assert.equal(sha(fs.readFileSync(path.join(b.dir, b.fileName))), sha(payload));
  }
  assert.ok(seen.socks >= 2, `SOCKS connections: ${seen.socks}`);
});

test('the default bypass list keeps localhost direct', async () => {
  seen.http = 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grabbit-proxy-'));
  const m = new DownloadManager(path.join(dir, 'data'));
  m.load();
  m.updateSettings({ downloadDir: path.join(dir, 'out'), proxyMode: 'manual', proxyUrl: httpProxy });
  const d = await done(m, m.add({ url: `${fileBase}/local.bin`, start: 'now' }).id);
  await m.shutdown();
  assert.equal(d.status, 'completed');
  assert.equal(seen.http, 0, 'nothing went through the proxy');
});

test('proxy strings and the system proxy formats', () => {
  assert.deepEqual(parseProxyUrl('10.0.0.1:3128'), { protocol: 'http', host: '10.0.0.1', port: 3128 });
  assert.deepEqual(parseProxyUrl('socks5h://u:p%40ss@proxy.lan'), { protocol: 'socks5', host: 'proxy.lan', port: 1080, username: 'u', password: 'p@ss' });
  assert.equal(parseProxyUrl('ftp://x'), null);
  const w = parseWindowsProxy('http=10.0.0.1:80;https=10.0.0.2:443', '*.corp.lan;<local>');
  assert.equal(w.http?.host, '10.0.0.1');
  assert.equal(w.https?.port, 443);
  assert.deepEqual(w.bypass, ['*.corp.lan', '<local>']);
  const mac = parseScutil(`<dictionary> {\n  ExceptionsList : <array> {\n    0 : *.local\n  }\n  HTTPEnable : 1\n  HTTPPort : 8080\n  HTTPProxy : 192.168.1.5\n  HTTPSEnable : 0\n}`);
  assert.equal(mac.http?.host, '192.168.1.5');
  assert.equal(mac.https, null);
  assert.deepEqual(mac.bypass, ['*.local']);
});
