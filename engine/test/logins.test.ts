// Site logins: HTTP Basic and Digest (with qop=auth) against real local servers, the prompt when a login is missing or
// wrong, and the encrypted vault (no password in the file or in the API's listing).
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, test } from 'node:test';
import type { DownloadItem, EngineEvent } from '../../shared/protocol';
import { DownloadManager } from '../src/core/DownloadManager';
import { SecretStore, normalizeSite, siteMatches } from '../src/core/secrets';

const SIZE = 3 * 1024 * 1024;
const payload = randomBytes(SIZE);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
let server: http.Server;
let base = '';
const counts = { challenges: 0, ok: 0 };
const NONCE = randomBytes(8).toString('hex');

function serveFile(req: http.IncomingMessage, res: http.ServerResponse): void {
  counts.ok++;
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
  const start = m ? Number(m[1]) : 0;
  const end = m && m[2] ? Number(m[2]) : SIZE - 1;
  res.writeHead(m ? 206 : 200, { 'Content-Length': end - start + 1, ...(m ? { 'Content-Range': `bytes ${start}-${end}/${SIZE}` } : {}) });
  res.end(payload.subarray(start, end + 1));
}

/** Checks a Digest Authorization header the way a server would (MD5, qop=auth). */
function digestOk(header: string | undefined, uri: string): boolean {
  if (!header?.startsWith('Digest ')) return false;
  const p: Record<string, string> = {};
  for (const m of header.matchAll(/(\w+)=(?:"([^"]*)"|([^\s,]+))/g)) p[m[1]] = m[2] ?? m[3];
  if (p.username !== 'dave' || p.nonce !== NONCE || p.uri !== uri) return false;
  const ha1 = md5(`dave:files:digest-pw`);
  const ha2 = md5(`GET:${uri}`);
  return p.response === md5(`${ha1}:${NONCE}:${p.nc}:${p.cnonce}:auth:${ha2}`);
}

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url!.startsWith('/basic/')) {
      if (req.headers.authorization === `Basic ${Buffer.from('carol:basic-pw').toString('base64')}`) return serveFile(req, res);
      counts.challenges++;
      return void res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Members"' }).end();
    }
    if (req.url!.startsWith('/digest/')) {
      if (digestOk(req.headers.authorization, req.url!)) return serveFile(req, res);
      counts.challenges++;
      return void res.writeHead(401, { 'WWW-Authenticate': `Digest realm="files", nonce="${NONCE}", qop="auth", algorithm=MD5, opaque="xyz"` }).end();
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

function makeManager(): { m: DownloadManager; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grabbit-logins-'));
  const m = new DownloadManager(path.join(dir, 'data'));
  m.load();
  m.updateSettings({ downloadDir: path.join(dir, 'out'), retryDelaySec: 1, maxRetries: 1 });
  return { m, dir };
}

function settle(m: DownloadManager, id: string): Promise<DownloadItem> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout: ${m.get(id)?.status}`)), 20000);
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

test('no saved login: the download stops and the window is asked for one; after saving it, resume works', async () => {
  const { m } = makeManager();
  const events: EngineEvent[] = [];
  m.on('event', (e: EngineEvent) => events.push(e));
  const d = m.add({ url: `${base}/basic/a.bin`, start: 'now', connections: 4 });
  const failed = await settle(m, d.id);
  assert.equal(failed.status, 'error');
  assert.match(failed.error ?? '', /needs a username and password/);
  const ask = events.find((e) => e.type === 'login.required');
  assert.deepEqual(ask, { type: 'login.required', downloadId: d.id, site: 'localhost', realm: 'Members', failed: false });

  m.secrets.add('localhost', 'carol', 'basic-pw');
  counts.challenges = 0;
  // The failed run reports its error a moment before it has fully ended; a person typing a password is slower.
  await new Promise((r) => setTimeout(r, 100));
  await m.bulk([d.id], 'start');
  const ok = await settle(m, d.id);
  assert.equal(ok.status, 'completed', ok.error ?? '');
  assert.equal(sha(fs.readFileSync(path.join(ok.dir, ok.fileName))), sha(payload));
  // Only the first request collects a 401; the other segments send the login up front.
  assert.ok(counts.challenges <= 1, `401 responses after saving the login: ${counts.challenges}`);
  await m.shutdown();
});

test('Digest login (qop=auth) with several connections', async () => {
  const { m } = makeManager();
  m.secrets.add('http://localhost/whatever', 'dave', 'digest-pw');
  counts.ok = 0;
  const d = await settle(m, m.add({ url: `${base}/digest/b.bin`, start: 'now', connections: 4 }).id);
  assert.equal(d.status, 'completed', d.error ?? '');
  assert.equal(sha(fs.readFileSync(path.join(d.dir, d.fileName))), sha(payload));
  assert.ok(counts.ok >= 3, `authorized requests: ${counts.ok}`);
  await m.shutdown();
});

test('a wrong saved password is reported as refused', async () => {
  const { m } = makeManager();
  const events: EngineEvent[] = [];
  m.on('event', (e: EngineEvent) => events.push(e));
  m.secrets.add('localhost', 'carol', 'wrong');
  const d = await settle(m, m.add({ url: `${base}/basic/c.bin`, start: 'now' }).id);
  assert.equal(d.status, 'error');
  assert.match(d.error ?? '', /refused the saved username or password/);
  assert.ok(events.some((e) => e.type === 'login.required' && e.failed));
  await m.shutdown();
});

test('the vault is encrypted, the listing has no passwords, and a different key reads nothing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grabbit-vault-'));
  const key = randomBytes(32).toString('hex');
  const a = new SecretStore(dir, key);
  a.load();
  a.add('.example.com', 'erin', 'very-secret-password');
  a.addArchivePassword('zip-pass-123');
  await a.flush();
  const raw = fs.readFileSync(path.join(dir, 'secrets.enc'));
  assert.ok(!raw.includes('very-secret-password') && !raw.includes('erin') && !raw.includes('zip-pass-123'));
  assert.ok(!JSON.stringify(a.list()).includes('very-secret-password'));

  const b = new SecretStore(dir, key);
  b.load();
  assert.deepEqual(b.lookup('dl.example.com'), { username: 'erin', password: 'very-secret-password' });
  assert.deepEqual(b.archivePasswords(), ['zip-pass-123']);

  const other = new SecretStore(dir, randomBytes(32).toString('hex'));
  other.load();
  assert.equal(other.lookup('dl.example.com'), null);
});

test('site patterns', () => {
  assert.equal(normalizeSite('https://Files.Example.com:8443/dl/x.zip'), 'files.example.com');
  assert.equal(normalizeSite('*.example.com'), '.example.com');
  assert.ok(siteMatches('.example.com', 'example.com'));
  assert.ok(siteMatches('.example.com', 'a.b.example.com'));
  assert.ok(!siteMatches('.example.com', 'badexample.com'));
  assert.ok(!siteMatches('files.example.com', 'example.com'));
});
