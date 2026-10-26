// Archive extraction after download (ZIP, encrypted 7z, a multi-part set) with a real 7-Zip, and the tools manager's
// download path against a fake GitHub release feed (checksum checked, a bad one refused). The extraction tests are
// skipped where no 7-Zip is installed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, test } from 'node:test';
import type { DownloadItem } from '../../shared/protocol';
import { DownloadManager } from '../src/core/DownloadManager';
import { archiveName } from '../src/core/extract';
import { ToolManager } from '../src/core/tools';

const sevenZip = new ToolManager(fs.mkdtempSync(path.join(os.tmpdir(), 'grabbit-tools-'))).info('7zip').path;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'grabbit-extract-'));
const served = path.join(work, 'served');
const inner = { 'readme.txt': Buffer.from('hello from inside the archive\n'), 'data.bin': randomBytes(400 * 1024) };
let server: http.Server;
let base = '';
const feedHits = { api: 0 };
const fakeTool = randomBytes(64 * 1024);
let feedDigest = '';

before(async () => {
  fs.mkdirSync(served);
  const src = path.join(work, 'src');
  fs.mkdirSync(src);
  for (const [n, b] of Object.entries(inner)) fs.writeFileSync(path.join(src, n), b);
  if (sevenZip) {
    const a = (...args: string[]) => execFileSync(sevenZip, ['a', '-bso0', '-bsp0', ...args], { cwd: src });
    a(path.join(served, 'plain.zip'), 'readme.txt', 'data.bin');
    a('-psesame', '-mhe=on', path.join(served, 'secret.7z'), 'readme.txt', 'data.bin');
    a('-v150k', '-mx0', path.join(served, 'multi.7z'), 'readme.txt', 'data.bin');
  }
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    if (url.pathname === '/repos/yt-dlp/yt-dlp/releases/latest') {
      feedHits.api++;
      const assetName = process.platform === 'win32' ? (process.arch === 'arm64' ? 'yt-dlp_arm64.exe' : 'yt-dlp.exe') : process.platform === 'darwin' ? 'yt-dlp_macos' : process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return void res.end(JSON.stringify({ tag_name: '2026.10.01', assets: [{ name: assetName, browser_download_url: `${base}/asset/yt`, size: fakeTool.length, digest: feedDigest }] }));
    }
    if (url.pathname === '/asset/yt') return void res.writeHead(200, { 'Content-Length': fakeTool.length }).end(fakeTool);
    const file = path.join(served, path.basename(url.pathname));
    if (!fs.existsSync(file)) return void res.writeHead(404).end();
    const body = fs.readFileSync(file);
    res.writeHead(200, { 'Content-Length': body.length, 'Content-Type': 'application/octet-stream' }).end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

function makeManager(): DownloadManager {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grabbit-extract-m-'));
  const m = new DownloadManager(path.join(dir, 'data'));
  m.load();
  m.updateSettings({ downloadDir: path.join(dir, 'out'), extractArchives: true, proxyMode: 'none', retryDelaySec: 1, maxRetries: 1 });
  return m;
}

/** Resolves once `pred` holds for the item (checked on every event). */
function waitFor(m: DownloadManager, id: string, pred: (d: DownloadItem) => boolean, ms = 30000): Promise<DownloadItem> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout: ${JSON.stringify(m.get(id)?.post)} ${m.get(id)?.status}`)), ms);
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
const extracted = (d: DownloadItem) => d.status === 'completed' && d.post.step === null && d.post.extract !== null;

test('archive names and multi-part sets', () => {
  assert.deepEqual(archiveName('Movie.Part01.rar'), { group: 'movie.rar', first: true, base: 'Movie' });
  assert.equal(archiveName('movie.part2.rar')!.first, false);
  assert.deepEqual(archiveName('backup.7z.001'), { group: 'backup.7z', first: true, base: 'backup' });
  assert.equal(archiveName('backup.7z.002')!.group, 'backup.7z');
  assert.deepEqual(archiveName('old.rar'), { group: 'old.rar', first: true, base: 'old' });
  assert.deepEqual(archiveName('old.r00'), { group: 'old.rar', first: false, base: 'old' });
  assert.equal(archiveName('split.z01')!.group, 'split.zip');
  assert.equal(archiveName('split.zip')!.first, true);
  assert.equal(archiveName('photo.jpg'), null);
  assert.equal(archiveName('setup.exe'), null);
});

test('a ZIP is extracted into a folder next to it', { skip: !sevenZip && 'no 7-Zip on this machine' }, async () => {
  const m = makeManager();
  const d = await waitFor(m, m.add({ url: `${base}/plain.zip`, start: 'now' }).id, extracted);
  assert.equal(d.post.extract, 'done', d.post.message ?? '');
  assert.equal(d.post.extractedTo, path.join(d.dir, 'plain'));
  for (const [n, b] of Object.entries(inner)) assert.ok(fs.readFileSync(path.join(d.post.extractedTo!, n)).equals(b), n);
  assert.ok(fs.existsSync(path.join(d.dir, d.fileName)), 'the archive is kept by default');
  await m.shutdown();
});

test('an encrypted 7z asks for a password; the typed one works and is saved', { skip: !sevenZip && 'no 7-Zip on this machine' }, async () => {
  const m = makeManager();
  const id = m.add({ url: `${base}/secret.7z`, start: 'now' }).id;
  const d = await waitFor(m, id, extracted);
  assert.equal(d.post.extract, 'password');
  assert.equal(d.post.extractedTo, null);
  assert.ok(!fs.existsSync(path.join(d.dir, 'secret')), 'no half-extracted folder is left');

  // (Post-processing lets go of the item a moment after its last event.)
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await m.extractNow(id, 'wrong')).post.extract, 'password');
  const ok = await m.extractNow(id, 'sesame');
  assert.equal(ok.post.extract, 'done', ok.post.message ?? '');
  assert.ok(fs.readFileSync(path.join(ok.post.extractedTo!, 'data.bin')).equals(inner['data.bin']));
  assert.deepEqual(m.secrets.archivePasswords(), ['sesame']);
  await m.shutdown();
});

test('a multi-part set is extracted once, after its last part, and the parts can be deleted', { skip: !sevenZip && 'no 7-Zip on this machine' }, async () => {
  const m = makeManager();
  m.updateSettings({ deleteArchiveAfterExtract: true });
  const parts = fs.readdirSync(served).filter((f) => f.startsWith('multi.7z.')).sort();
  assert.ok(parts.length >= 3, `parts: ${parts}`);
  // The first part arrives first: nothing can be extracted until the rest are here.
  const firstId = m.add({ url: `${base}/${parts[0]}`, start: 'now' }).id;
  await waitFor(m, firstId, (d) => d.status === 'completed' && d.post.step === null);
  assert.equal(m.get(firstId)!.post.extract, null);

  const ids = parts.slice(1).map((p) => m.add({ url: `${base}/${p}`, start: 'now' }).id);
  const all = await Promise.all([firstId, ...ids].map((id) => waitFor(m, id, extracted)));
  for (const d of all) assert.equal(d.post.extract, 'done', d.post.message ?? '');
  const dest = all[0].post.extractedTo!;
  assert.equal(dest, path.join(all[0].dir, 'multi'));
  assert.ok(fs.readFileSync(path.join(dest, 'data.bin')).equals(inner['data.bin']));
  for (const d of all) assert.ok(!fs.existsSync(path.join(d.dir, d.fileName)), `${d.fileName} deleted`);
  await m.shutdown();
});

test('tools: downloaded from the release feed, checksum checked, not re-checked within a day', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grabbit-tools-dl-'));
  feedDigest = `sha256:${createHash('sha256').update(fakeTool).digest('hex')}`;
  const tools = new ToolManager(dir, base, false);
  assert.equal(tools.info('yt-dlp').state, 'missing');
  const events: number[] = [];
  tools.on('tools', () => events.push(1));
  const bin = await tools.ensure('yt-dlp');
  assert.ok(fs.readFileSync(bin).equals(fakeTool));
  assert.deepEqual({ ...tools.info('yt-dlp'), path: null }, {
    name: 'yt-dlp', label: 'yt-dlp', state: 'ready', source: 'grabbit', path: null, version: '2026.10.01', received: 0, size: null, error: null,
  });
  assert.ok(events.length >= 2);
  const hits = feedHits.api;
  assert.equal(await tools.ensure('yt-dlp'), bin);
  assert.equal(feedHits.api, hits, 'no update check within a day');

  // A new manager reads what's installed from disk (written in the background).
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(new ToolManager(dir, base, false).info('yt-dlp').path, bin);
  tools.remove('yt-dlp');
  assert.equal(tools.info('yt-dlp').state, 'missing');

  feedDigest = `sha256:${'0'.repeat(64)}`;
  await assert.rejects(new ToolManager(dir, base, false).ensure('yt-dlp'), /failed its checksum/);
  assert.ok(!fs.existsSync(path.join(dir, 'tools', 'yt-dlp')));
});
