// Video downloads with a stand-in yt-dlp (test/fake-ytdlp.mjs): the quality list, probing a page, progress across the
// video and audio tracks and the merge, a site error, pause and resume, and single-file formats without ffmpeg.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import type { DownloadItem, DownloadStatus, EngineEvent } from '../../shared/protocol';
import { DownloadManager } from '../src/core/DownloadManager';
import { videoOptions, withoutMerging } from '../src/core/video';

const FAKE = path.join(import.meta.dirname, 'fake-ytdlp.mjs');
const BEST = { format: 'bv*+ba/b', label: 'Best quality' };

function makeManager(ffmpeg: string | null = 'C:/fake/ffmpeg'): { m: DownloadManager; log: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grabbit-video-'));
  const m = new DownloadManager(path.join(dir, 'data'));
  m.load();
  m.updateSettings({ downloadDir: path.join(dir, 'out'), proxyMode: 'none' });
  const log = path.join(dir, 'ytdlp.log');
  process.env.FAKE_YTDLP_LOG = log;
  m.ytdlp = async () => [process.execPath, FAKE];
  m.ffmpeg = async () => ffmpeg;
  return { m, log };
}

const runs = (log: string): string[][] => fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[]);

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

test('quality options: best, each height, audio only, with size estimates', () => {
  const opts = videoOptions({
    duration: 10,
    formats: [
      { format_id: 'a', height: 1080, vcodec: 'vp9', acodec: 'none', filesize: 3000 },
      { format_id: 'b', height: 720, vcodec: 'avc1', acodec: 'none', filesize: 1500 },
      { format_id: 'c', height: 360, vcodec: 'avc1', acodec: 'mp4a', filesize: 800 },
      { format_id: 'd', ext: 'm4a', vcodec: 'none', acodec: 'mp4a', filesize: 500 },
    ],
  });
  assert.deepEqual(
    opts.map((o) => [o.label, o.format, o.size]),
    [
      ['Best quality (1080p)', 'bv*+ba/b', 3500],
      ['720p', 'bv*[height<=720]+ba/b[height<=720]', 2000],
      ['360p', 'bv*[height<=360]+ba/b[height<=360]', 800],
      ['Audio only', 'ba[ext=m4a]/ba/b', 500],
    ],
  );
  assert.equal(withoutMerging('bv*+ba/b'), 'b');
  assert.equal(withoutMerging('bv*[height<=720]+ba/b[height<=720]'), 'b[height<=720]/b');
  assert.equal(withoutMerging('ba[ext=m4a]/ba/b'), 'ba[ext=m4a]/ba/b');
});

test('probe a page: title, site and qualities; a page without a video says why', async () => {
  const { m } = makeManager();
  const p = await m.probeVideo('https://www.youtube.com/watch?v=abc123');
  assert.equal(p.title, 'Test Clip: "one"/two');
  assert.equal(p.site, 'Youtube');
  assert.equal(p.duration, 10);
  assert.deepEqual(p.options.map((o) => o.label), ['Best quality (1080p)', '720p', '360p', 'Audio only']);
  await assert.rejects(m.probeVideo('https://example.com/novideo'), /Unsupported URL/);
  await assert.rejects(m.probeVideo('ftp://example.com/x'), /web page/);
  await m.shutdown();
});

test('download: two tracks then the merge, named after the title, with the right options', async () => {
  const { m, log } = makeManager();
  m.updateSettings({ speedLimitEnabled: true, speedLimit: 2_000_000 });
  const seen = new Set<DownloadStatus>();
  m.on('event', (e: EngineEvent) => {
    if (e.type === 'download.updated') seen.add(e.item.status);
  });
  const id = m.add({ url: 'https://www.youtube.com/watch?v=abc123', fileName: 'Test Clip: "one"/two.mp4', video: BEST, start: 'now' }).id;
  assert.equal(m.get(id)!.category, 'video');
  const d = await settle(m, id);
  assert.equal(d.status, 'completed', d.error ?? '');
  assert.ok(seen.has('downloading') && seen.has('completing'), [...seen].join());
  assert.equal(d.size, 80_000);
  assert.equal(d.received, 80_000);
  assert.equal(fs.statSync(path.join(d.dir, d.fileName)).size, 80_000);
  assert.equal(d.fileName, 'Test Clip_ _one_two.mp4');
  const args = runs(log)[0];
  assert.equal(args[args.indexOf('-f') + 1], 'bv*+ba/b');
  assert.equal(args[args.indexOf('--ffmpeg-location') + 1], 'C:/fake/ffmpeg');
  assert.equal(args[args.indexOf('--limit-rate') + 1], '2000000');
  assert.equal(args[args.indexOf('--proxy') + 1], '', 'no proxy in Grabbit means none for yt-dlp either');
  assert.equal(args[args.length - 1], 'https://www.youtube.com/watch?v=abc123');
  await m.shutdown();
});

test('without ffmpeg, a single-file format is requested', async () => {
  const { m, log } = makeManager(null);
  const d = await settle(m, m.add({ url: 'https://vimeo.com/1', fileName: 'clip.mp4', video: { format: 'bv*[height<=720]+ba/b[height<=720]', label: '720p' }, start: 'now' }).id);
  assert.equal(d.status, 'completed', d.error ?? '');
  const args = runs(log)[0];
  assert.equal(args[args.indexOf('-f') + 1], 'b[height<=720]/b');
  assert.ok(!args.includes('--ffmpeg-location'));
  await m.shutdown();
});

test("a site error is shown as yt-dlp's message", async () => {
  const { m } = makeManager();
  const d = await settle(m, m.add({ url: 'https://www.youtube.com/watch?v=fail', fileName: 'x.mp4', video: BEST, start: 'now' }).id);
  assert.equal(d.status, 'error');
  assert.equal(d.error, 'Video unavailable. This video is private');
  await m.shutdown();
});

test('pause stops yt-dlp at once; start runs it again', async () => {
  const { m, log } = makeManager();
  const id = m.add({ url: 'https://www.youtube.com/watch?v=slow', fileName: 'slow.mp4', video: BEST, start: 'now' }).id;
  await new Promise((r) => setTimeout(r, 1200));
  const t0 = Date.now();
  await m.bulk([id], 'pause');
  assert.ok(Date.now() - t0 < 3000, 'paused quickly');
  assert.equal(m.get(id)!.status, 'stopped');
  assert.ok(m.get(id)!.received > 0);
  await m.bulk([id], 'start');
  const d = await settle(m, id);
  assert.equal(d.status, 'completed', d.error ?? '');
  assert.equal(runs(log).length, 2);
  await m.shutdown();
});

test('bad video requests are refused', async () => {
  const { m } = makeManager();
  assert.throws(() => m.add({ url: 'https://x.test/v', video: { format: 'b; rm -rf /', label: 'x' } }), /Unknown video format/);
  assert.throws(() => m.add({ url: 'ftp://x.test/v', video: BEST }), /web pages/);
  await m.shutdown();
});
