// FTP and SFTP downloads against real local servers: segments and resume over FTP (REST), anonymous and saved logins,
// a missing file, and SFTP with a password, ranged reads and the trusted-on-first-use host key.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, test } from 'node:test';
import ssh2 from 'ssh2';
import type { DownloadItem, EngineEvent } from '../../shared/protocol';
import { DownloadManager } from '../src/core/DownloadManager';
import { isSupportedUrl } from '../src/core/sources';
// @ts-expect-error: a plain .mjs script without type declarations
import { byteAt, startFtpServer } from '../../scripts/ftp-test-server.mjs';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const expected = (n: number) => {
  const b = Buffer.allocUnsafe(n);
  for (let i = 0; i < n; i++) b[i] = (byteAt as (i: number) => number)(i);
  return b;
};

type Ftp = { server: import('node:net').Server; port: number; stats: { logins: number; retrieves: number; rests: number } };
let open: Ftp;
let locked: Ftp;

before(async () => {
  open = await startFtpServer({ kbps: 300 });
  locked = await startFtpServer({ user: 'fred', pass: 'ftp-pw' });
});

after(() => {
  open.server.close();
  locked.server.close();
});

function makeManager(): DownloadManager {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grabbit-sources-'));
  const m = new DownloadManager(path.join(dir, 'data'));
  m.load();
  m.updateSettings({ downloadDir: path.join(dir, 'out'), retryDelaySec: 1, maxRetries: 1, proxyMode: 'none' });
  return m;
}

function settle(m: DownloadManager, id: string, ms = 30000): Promise<DownloadItem> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout: ${m.get(id)?.status}`)), ms);
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

const fileOf = (d: DownloadItem) => fs.readFileSync(path.join(d.dir, d.fileName));

test('supported addresses', () => {
  assert.ok(isSupportedUrl('ftp://example.com/a.iso'));
  assert.ok(isSupportedUrl('sftp://user@example.com/home/a.iso'));
  assert.ok(isSupportedUrl(' https://example.com/a '));
  assert.ok(!isSupportedUrl('ftps://example.com/a'));
  assert.ok(!isSupportedUrl('file:///C:/a.txt'));
});

test('FTP: probe, anonymous login, several connections, pause and resume', async () => {
  const m = makeManager();
  const url = `ftp://127.0.0.1:${open.port}/pub/big-3mb.bin`;
  const info = await m.probe(url);
  assert.equal(info.size, 3 * 1024 * 1024);
  assert.equal(info.resumable, true);
  assert.equal(info.fileName, 'big-3mb.bin');

  const d = m.add({ url, start: 'now', connections: 4 });
  await new Promise((r) => setTimeout(r, 700));
  await m.bulk([d.id], 'pause');
  await new Promise((r) => setTimeout(r, 200));
  const paused = m.get(d.id)!;
  assert.equal(paused.status, 'stopped');
  assert.ok(paused.received > 0 && paused.received < paused.size!, `downloaded ${paused.received}`);
  assert.ok(paused.segments.length >= 2, `segments: ${paused.segments.length}`);
  const restsBefore = open.stats.rests;

  await m.bulk([d.id], 'start');
  const done = await settle(m, d.id);
  assert.equal(done.status, 'completed', done.error ?? '');
  assert.equal(sha(fileOf(done)), sha(expected(3 * 1024 * 1024)));
  assert.ok(open.stats.rests > restsBefore, 'resumed with REST');
  await m.shutdown();
});

test('FTP: a login is asked for, then the saved one is used; a missing file fails at once', async () => {
  const m = makeManager();
  const events: EngineEvent[] = [];
  m.on('event', (e: EngineEvent) => events.push(e));
  const url = `ftp://127.0.0.1:${locked.port}/private/report-1mb.pdf`;
  const d = m.add({ url, start: 'now', connections: 2 });
  const failed = await settle(m, d.id);
  assert.equal(failed.status, 'error');
  assert.ok(events.some((e) => e.type === 'login.required' && e.site === '127.0.0.1' && !e.failed));

  m.secrets.add('127.0.0.1', 'fred', 'ftp-pw');
  await new Promise((r) => setTimeout(r, 100));
  await m.bulk([d.id], 'start');
  const ok = await settle(m, d.id);
  assert.equal(ok.status, 'completed', ok.error ?? '');
  assert.equal(sha(fileOf(ok)), sha(expected(1024 * 1024)));

  const t0 = Date.now();
  const missing = await settle(m, m.add({ url: `ftp://127.0.0.1:${locked.port}/missing.zip`, start: 'now' }).id);
  assert.equal(missing.status, 'error');
  assert.match(missing.error ?? '', /not on the FTP server/);
  assert.ok(Date.now() - t0 < 3000, 'no retries for a missing file');
  await m.shutdown();
});

test('FTP: user and password in the address', async () => {
  const m = makeManager();
  const d = await settle(m, m.add({ url: `ftp://fred:ftp-pw@127.0.0.1:${locked.port}/x-0.5mb.bin`, start: 'now' }).id);
  assert.equal(d.status, 'completed', d.error ?? '');
  assert.equal(fileOf(d).length, 512 * 1024);
  await m.shutdown();
});

/** A read-only SFTP server for one file, /data/file.bin, with the login sam / sftp-pw. */
function startSftp(content: Buffer, port = 0): Promise<{ server: InstanceType<typeof ssh2.Server>; port: number; reads: { n: number } }> {
  const hostKey = ssh2.utils.generateKeyPairSync('ed25519').private;
  const reads = { n: 0 };
  const server = new ssh2.Server({ hostKeys: [hostKey] }, (client) => {
    client.on('error', () => undefined);
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === 'sam' && ctx.password === 'sftp-pw') ctx.accept();
      else ctx.reject(['password']);
    });
    client.on('ready', () => {
      client.on('session', (accept) => {
        accept().on('sftp', (acceptSftp) => {
          const sftp = acceptSftp();
          const STATUS = ssh2.utils.sftp.STATUS_CODE;
          const handles = new Set<number>();
          let next = 0;
          const attrs = () => ({ mode: 0o100644, uid: 0, gid: 0, size: content.length, atime: 0, mtime: 0 });
          sftp.on('OPEN', (id, file) => {
            if (file !== '/data/file.bin') return void sftp.status(id, STATUS.NO_SUCH_FILE);
            const h = next++;
            handles.add(h);
            const b = Buffer.alloc(4);
            b.writeUInt32BE(h);
            sftp.handle(id, b);
          });
          sftp.on('READ', (id, handle, offset, length) => {
            if (!handles.has(handle.readUInt32BE(0))) return void sftp.status(id, STATUS.FAILURE);
            if (offset >= content.length) return void sftp.status(id, STATUS.EOF);
            reads.n++;
            sftp.data(id, content.subarray(offset, Math.min(content.length, offset + length)));
          });
          sftp.on('FSTAT', (id) => sftp.attrs(id, attrs()));
          const stat = (id: number, p: string) => (p === '/data/file.bin' ? sftp.attrs(id, attrs()) : sftp.status(id, STATUS.NO_SUCH_FILE));
          sftp.on('STAT', stat);
          sftp.on('LSTAT', stat);
          sftp.on('REALPATH', (id, p) => sftp.name(id, [{ filename: p, longname: p, attrs: attrs() }]));
          sftp.on('CLOSE', (id, handle) => {
            handles.delete(handle.readUInt32BE(0));
            sftp.status(id, STATUS.OK);
          });
        });
      });
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port, reads })));
}

test('SFTP: password login, several connections, then a changed host key is refused', async () => {
  const content = randomBytes(2 * 1024 * 1024 + 123);
  const s = await startSftp(content);
  const m = makeManager();
  m.secrets.add('127.0.0.1', 'sam', 'sftp-pw');
  const url = `sftp://127.0.0.1:${s.port}/data/file.bin`;
  const info = await m.probe(url);
  assert.equal(info.size, content.length);
  assert.equal(info.resumable, true);

  const d = await settle(m, m.add({ url, start: 'now', connections: 3 }).id);
  assert.equal(d.status, 'completed', d.error ?? '');
  assert.equal(sha(fileOf(d)), sha(content));

  const missing = await settle(m, m.add({ url: `sftp://127.0.0.1:${s.port}/data/nope.bin`, start: 'now' }).id);
  assert.equal(missing.status, 'error');
  assert.match(missing.error ?? '', /not on the SFTP server/);

  // Same address, new host key: like ssh, refuse until the user removes the old key.
  const port = s.port;
  s.server.close();
  const impostor = await startSftp(content, port);
  const refused = await settle(m, m.add({ url, start: 'now' }).id);
  assert.equal(refused.status, 'error');
  assert.match(refused.error ?? '', /host key changed/);
  impostor.server.close();
  await m.shutdown();
});
