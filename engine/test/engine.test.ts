import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, test } from 'node:test';
import type { DownloadItem, EngineEvent } from '../../shared/protocol';
import { DownloadManager } from '../src/core/DownloadManager';
import { fileNameFrom } from '../src/core/util';

const SIZE = 6 * 1024 * 1024 + 123;
const payload = randomBytes(SIZE);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
let server: http.Server;
let base = '';
let flakyHits = 0;

/** Test server: /file honours Range and trickles bytes (so ranges get split); /norange ignores Range; /flaky drops connections. */
before(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? '';
    if (url.startsWith('/redirect')) {
      res.writeHead(302, { Location: '/file' }).end();
      return;
    }
    if (url.startsWith('/missing')) {
      res.writeHead(404).end();
      return;
    }
    const ranged = !url.startsWith('/norange');
    const m = ranged ? /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '') : null;
    const start = m ? Number(m[1]) : 0;
    const end = m && m[2] ? Number(m[2]) : SIZE - 1;
    const headers: Record<string, string | number> = {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename*=UTF-8''test%20file.zip`,
      'Content-Length': end - start + 1,
    };
    if (m) headers['Content-Range'] = `bytes ${start}-${end}/${SIZE}`;
    res.writeHead(m ? 206 : 200, headers);
    const body = payload.subarray(start, end + 1);
    if (url.startsWith('/flaky') && flakyHits++ < 3) {
      // Send a little, then cut the connection.
      res.write(body.subarray(0, 1000));
      setTimeout(() => res.destroy(), 20);
      return;
    }
    // Trickle (~1 MB/s per connection) so a download lasts long enough for progress ticks and range splitting.
    let off = 0;
    const pump = () => {
      if (res.destroyed) return;
      if (off >= body.length) return void res.end();
      const piece = body.subarray(off, off + 32 * 1024);
      off += piece.length;
      const later = () => setTimeout(pump, 30);
      if (res.write(piece)) later();
      else res.once('drain', later);
    };
    pump();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

function makeManager(): { m: DownloadManager; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grabbit-test-'));
  const m = new DownloadManager(path.join(dir, 'data'));
  m.load();
  m.updateSettings({ downloadDir: path.join(dir, 'out'), retryDelaySec: 1, maxRetries: 5 });
  return { m, dir };
}

function waitFor(m: DownloadManager, id: string, statuses: string[], timeoutMs = 30000): Promise<DownloadItem> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${statuses.join('/')}: ${m.get(id)?.status}`)), timeoutMs);
    const check = () => {
      const d = m.get(id);
      if (d && statuses.includes(d.status)) {
        clearTimeout(t);
        m.off('event', check);
        resolve(d);
      }
    };
    m.on('event', check);
    check();
  });
}

test('file name from Content-Disposition and URL', () => {
  assert.equal(fileNameFrom('http://x/a.zip', `attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf`), 'résumé.pdf');
  assert.equal(fileNameFrom('http://x/a.zip', 'attachment; filename="report.pdf"'), 'report.pdf');
  assert.equal(fileNameFrom('http://x/dir/some%20file.iso?x=1'), 'some file.iso');
  assert.equal(fileNameFrom('http://x/a', 'attachment; filename="con"'), '_con');
});

test('probe reports size, resume support, name and category', async () => {
  const { m } = makeManager();
  const p = await m.probe(`${base}/redirect`);
  assert.equal(p.size, SIZE);
  assert.equal(p.resumable, true);
  assert.equal(p.fileName, 'test file.zip');
  assert.equal(p.category, 'compressed');
  assert.ok(p.finalUrl.endsWith('/file'));
  await m.shutdown();
});

test('segmented download with dynamic splitting produces an identical file', async () => {
  const { m } = makeManager();
  const d = m.add({ url: `${base}/file`, start: 'now', connections: 8 });
  let maxSegments = 0;
  m.on('event', (e: EngineEvent) => {
    if (e.type === 'progress') for (const p of e.entries) maxSegments = Math.max(maxSegments, p.segments.filter((s) => s.active).length);
  });
  const done = await waitFor(m, d.id, ['completed', 'error']);
  assert.equal(done.status, 'completed', done.error ?? '');
  const file = path.join(done.dir, done.fileName);
  assert.equal(sha(fs.readFileSync(file)), sha(payload));
  assert.ok(!fs.existsSync(file + '.dlpart'));
  assert.ok(maxSegments > 1, `expected parallel connections, saw ${maxSegments}`);
  await m.shutdown();
});

test('pause and resume keeps the bytes and finishes correctly', async () => {
  const { m } = makeManager();
  const d = m.add({ url: `${base}/file`, start: 'now', connections: 4 });
  await new Promise((r) => setTimeout(r, 400));
  await m.bulk([d.id], 'pause');
  const paused = m.get(d.id)!;
  assert.equal(paused.status, 'stopped');
  const kept = paused.received;
  assert.ok(kept > 0 && kept < SIZE, `received ${kept}`);
  m.bulk([d.id], 'start');
  const done = await waitFor(m, d.id, ['completed', 'error']);
  assert.equal(done.status, 'completed', done.error ?? '');
  assert.equal(sha(fs.readFileSync(path.join(done.dir, done.fileName))), sha(payload));
  await m.shutdown();
});

test('server without Range support falls back to a single connection', async () => {
  const { m } = makeManager();
  const d = m.add({ url: `${base}/norange/file.bin`, start: 'now' });
  const done = await waitFor(m, d.id, ['completed', 'error']);
  assert.equal(done.status, 'completed', done.error ?? '');
  assert.equal(done.resumable, false);
  assert.equal(sha(fs.readFileSync(path.join(done.dir, done.fileName))), sha(payload));
  await m.shutdown();
});

test('dropped connections are retried', async () => {
  const { m } = makeManager();
  flakyHits = 0;
  const d = m.add({ url: `${base}/flaky/file.bin`, start: 'now', connections: 2 });
  const done = await waitFor(m, d.id, ['completed', 'error']);
  assert.equal(done.status, 'completed', done.error ?? '');
  assert.ok(done.retries > 0);
  assert.equal(sha(fs.readFileSync(path.join(done.dir, done.fileName))), sha(payload));
  await m.shutdown();
});

test('404 fails without endless retries', async () => {
  const { m } = makeManager();
  const d = m.add({ url: `${base}/missing/x.zip`, start: 'now' });
  const done = await waitFor(m, d.id, ['completed', 'error'], 5000);
  assert.equal(done.status, 'error');
  assert.match(done.error ?? '', /404/);
  await m.shutdown();
});

test('queue runs items with its concurrency limit and duplicate names are renamed', async () => {
  const { m } = makeManager();
  m.updateQueue('main', { maxConcurrent: 2 });
  const ids = [1, 2, 3].map(() => m.add({ url: `${base}/file`, start: 'queue' }).id);
  const names = ids.map((id) => m.get(id)!.fileName);
  assert.equal(new Set(names).size, 3, names.join(', '));
  m.startQueue('main');
  await new Promise((r) => setTimeout(r, 150));
  const running = ids.filter((id) => ['connecting', 'downloading'].includes(m.get(id)!.status)).length;
  assert.equal(running, 2);
  for (const id of ids) await waitFor(m, id, ['completed']);
  await m.shutdown();
});

test('rapid settings changes are all saved, the last one wins', async () => {
  const { m, dir } = makeManager();
  for (let i = 1; i <= 25; i++) m.updateSettings({ maxRetries: i });
  await m.shutdown();
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'settings.json'), 'utf8'));
  assert.equal(saved.maxRetries, 25);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'data')).filter((f) => f.endsWith('.tmp')), []);
});

test('speed limit slows the transfer', async () => {
  const { m } = makeManager();
  m.updateSettings({ speedLimit: 1024 * 1024, speedLimitEnabled: true });
  const t0 = Date.now();
  const d = m.add({ url: `${base}/file`, start: 'now', connections: 8 });
  await waitFor(m, d.id, ['completed']);
  const secs = (Date.now() - t0) / 1000;
  // Unlimited, 8 connections fetch 6 MB in under a second; capped at 1 MB/s it takes about 6.
  assert.ok(secs > 4.5, `6 MB at 1 MB/s took ${secs}s`);
  await m.shutdown();
});
