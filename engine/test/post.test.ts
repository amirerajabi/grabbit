// After-download steps: checksum verification, on-demand hashing, the virus-scan hook and the when-done countdown.
// Power actions run with GRABBIT_POWER_DRY_RUN=1, so a failing test can never shut the machine down.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, test } from 'node:test';
import type { DownloadItem, EngineEvent } from '../../shared/protocol';
import { DownloadManager } from '../src/core/DownloadManager';
import { parseChecksum, powerCommand, splitCommand } from '../src/core/post';

process.env.GRABBIT_POWER_DRY_RUN = '1';
process.env.GRABBIT_WHEN_DONE_DELAY_MS = '300';

const payload = randomBytes(256 * 1024);
const clean = Buffer.from('nothing to see here');
const evil = Buffer.from('X5O!P%@AP-GRABBIT-TEST-THREAT');
let server: http.Server;
let base = '';

before(async () => {
  server = http.createServer((req, res) => {
    const body = req.url?.startsWith('/evil') ? evil : req.url?.startsWith('/clean') ? clean : payload;
    res.writeHead(200, { 'Content-Length': body.length, 'Content-Type': 'application/octet-stream' });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

function makeManager(): { m: DownloadManager; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grabbit-post-'));
  const m = new DownloadManager(path.join(dir, 'data'));
  m.load();
  m.updateSettings({ downloadDir: path.join(dir, 'out'), retryDelaySec: 1 });
  return { m, dir };
}

/** Resolves once `pred` holds for the item, checked on every engine event. */
function until(m: DownloadManager, id: string, pred: (d: DownloadItem) => boolean, timeoutMs = 15000): Promise<DownloadItem> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout: ${JSON.stringify(m.get(id)?.post)} ${JSON.stringify(m.get(id)?.checksum)}`)), timeoutMs);
    const check = () => {
      const d = m.get(id);
      if (d && pred(d)) {
        clearTimeout(t);
        m.off('event', check);
        resolve(d);
      }
    };
    m.on('event', check);
    check();
  });
}

const finished = (d: DownloadItem) => d.status === 'completed' && d.post.step === null && d.checksum?.state !== 'computing' && d.checksum?.state !== 'pending';
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

test('checksum strings: plain hex, prefixed, SUMS lines; junk is refused', () => {
  const hex = sha256(payload);
  assert.deepEqual(parseChecksum(hex.toUpperCase()), { algo: 'sha256', expected: hex, actual: null, state: 'pending' });
  assert.equal(parseChecksum(`SHA-256: ${hex}`)?.algo, 'sha256');
  assert.equal(parseChecksum(`${hex}  ubuntu.iso`)?.expected, hex);
  assert.equal(parseChecksum('d41d8cd98f00b204e9800998ecf8427e')?.algo, 'md5');
  assert.equal(parseChecksum('md5:' + hex), null, 'a SHA-256 is not an MD5');
  assert.equal(parseChecksum('not a hash'), null);
});

test('a matching checksum verifies, a wrong one is reported', async () => {
  const { m } = makeManager();
  const events: EngineEvent[] = [];
  m.on('event', (e: EngineEvent) => events.push(e));
  const good = m.add({ url: `${base}/good.bin`, start: 'now', checksum: sha256(payload) });
  const bad = m.add({ url: `${base}/bad.bin`, start: 'now', checksum: 'sha256:' + '0'.repeat(64) });
  const g = await until(m, good.id, finished);
  const b = await until(m, bad.id, finished);
  assert.equal(g.checksum?.state, 'ok');
  assert.equal(b.checksum?.state, 'mismatch');
  assert.equal(b.checksum?.actual, sha256(payload));
  assert.ok(events.some((e) => e.type === 'notify' && e.level === 'error' && e.text.startsWith('Checksum mismatch')));
  assert.throws(() => m.add({ url: `${base}/x.bin`, checksum: 'nope' }), /not an MD5/);
  await m.shutdown();
});

test('a finished file can be hashed on request', async () => {
  const { m } = makeManager();
  const d = m.add({ url: `${base}/file.bin`, start: 'now' });
  await until(m, d.id, (x) => x.status === 'completed' && x.post.step === null);
  const r = await m.computeChecksum(d.id, 'md5');
  assert.equal(r.checksum?.state, 'computed');
  assert.equal(r.checksum?.actual, createHash('md5').update(payload).digest('hex'));
  await m.shutdown();
});

test('the virus scan hook: clean files pass, a threat is flagged', async () => {
  const { m, dir } = makeManager();
  // A stand-in scanner: exit 1 (threat, ClamAV's convention) when the file contains the test marker.
  const scanner = path.join(dir, 'fake scanner.cjs');
  fs.writeFileSync(scanner, `process.exit(require('fs').readFileSync(process.argv[2],'utf8').includes('GRABBIT-TEST-THREAT') ? 1 : 0)`);
  m.updateSettings({ scanAfterDownload: true, scanCommand: `"${process.execPath}" "${scanner}" {file}` });
  const a = m.add({ url: `${base}/clean.txt`, start: 'now' });
  const b = m.add({ url: `${base}/evil.txt`, start: 'now' });
  assert.equal((await until(m, a.id, (d) => d.post.scan !== null && d.post.step === null)).post.scan, 'clean');
  assert.equal((await until(m, b.id, (d) => d.post.scan !== null && d.post.step === null)).post.scan, 'threat');
  await m.shutdown();
});

test('when-done: counts down after the last download, fires once, and a cancel stops it', async () => {
  const { m } = makeManager();
  const events: EngineEvent[] = [];
  m.on('event', (e: EngineEvent) => events.push(e));

  m.updateSettings({ whenDone: 'shutdown' });
  const d = m.add({ url: `${base}/file.bin`, start: 'now' });
  await until(m, d.id, (x) => x.status === 'completed');
  await new Promise((r) => setTimeout(r, 800));
  const countdown = events.find((e) => e.type === 'whenDone' && e.at !== null);
  assert.ok(countdown, 'a countdown started');
  const fired = events.find((e) => e.type === 'notify' && e.text === 'When done: shutdown');
  assert.ok(fired && fired.type === 'notify' && fired.detail === `dry run: ${powerCommand('shutdown')!.flat(2).join(' ')}`, 'the dry-run shutdown ran');
  assert.equal(m.getSettings().whenDone, 'nothing', 'one-shot: the setting resets');

  events.length = 0;
  m.updateSettings({ whenDone: 'sleep' });
  const e2 = m.add({ url: `${base}/file2.bin`, start: 'now' });
  await until(m, e2.id, (x) => x.status === 'completed' && x.post.step === null);
  m.cancelWhenDone();
  await new Promise((r) => setTimeout(r, 600));
  assert.ok(!events.some((e) => e.type === 'notify' && e.text.startsWith('When done')), 'cancelled: nothing ran');
  assert.equal(m.getSettings().whenDone, 'nothing');
  await m.shutdown();
});

test('power commands per OS; scanner command lines split without a shell', () => {
  assert.deepEqual(powerCommand('shutdown', 'win32'), ['shutdown', ['/s', '/t', '0']]);
  assert.deepEqual(powerCommand('hibernate', 'win32'), ['shutdown', ['/h']]);
  assert.deepEqual(powerCommand('sleep', 'linux'), ['systemctl', ['suspend']]);
  assert.equal(powerCommand('quit', 'win32'), null);
  assert.deepEqual(splitCommand('"C:\\Program Files\\x\\scan.exe" --quiet {file}'), ['C:\\Program Files\\x\\scan.exe', '--quiet', '{file}']);
});
