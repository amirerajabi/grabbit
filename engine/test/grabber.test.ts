// The site grabber against a small local site: depth, "stay on this site", file types, relative links and <base>,
// entity-encoded addresses, a page that links back to itself, and stopping a crawl.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, test } from 'node:test';
import type { EngineEvent } from '../../shared/protocol';
import { DownloadManager } from '../src/core/DownloadManager';
import { linksIn } from '../src/core/grabber';

let site: http.Server;
let other: http.Server;
let base = '';
let otherBase = '';
let slowHits = 0;

const html = (body: string) => `<!doctype html><html><body>${body}</body></html>`;

before(async () => {
  other = http.createServer((req, res) => {
    if (req.url === '/away.html') return void res.writeHead(200, { 'Content-Type': 'text/html' }).end(html('<a href="/far.zip">far</a>'));
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => other.listen(0, '127.0.0.1', r));
  otherBase = `http://127.0.0.1:${(other.address() as { port: number }).port}`;

  const pages: Record<string, string> = {
    '/': html(`
      <a href="a.zip">a</a> <a href='/docs/page2.html'>next</a> <a href=/index.html>self</a>
      <a href="${otherBase}/cdn.mp4">cdn video</a> <a href="${otherBase}/away.html">elsewhere</a>
      <img src="pic.jpg"> <a href="mailto:x@y.z">mail</a> <a href="#top">top</a> <a href="a.zip#again">dup</a>`),
    '/index.html': html('<a href="/">home</a>'),
    '/docs/page2.html': html(`<base href="/files/"><a href="b.mp4?x=1&amp;y=2">b</a> <a href="/docs/deep/">deeper</a>`),
    '/docs/deep/': html('<a href="c.pdf">c</a>'),
  };
  site = http.createServer((req, res) => {
    const u = new URL(req.url!, 'http://x');
    if (u.pathname.startsWith('/slow/')) {
      slowHits++;
      // Each slow page links to two more: without a stop, this never ends before the page limit.
      const n = Number(u.pathname.split('/')[2]) || 0;
      return void setTimeout(() => res.writeHead(200, { 'Content-Type': 'text/html' }).end(html(`<a href="/slow/${n * 2 + 1}">x</a><a href="/slow/${n * 2 + 2}">y</a>`)), 150);
    }
    const page = pages[u.pathname];
    if (page) return void res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end('file');
  });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
  base = `http://localhost:${(site.address() as { port: number }).port}`;
});

after(() => {
  for (const s of [site, other]) {
    s.closeAllConnections();
    s.close();
  }
});

function makeManager(): DownloadManager {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grabbit-grab-'));
  const m = new DownloadManager(path.join(dir, 'data'));
  m.load();
  m.updateSettings({ proxyMode: 'none' });
  return m;
}

const EXTS = ['zip', 'mp4', 'pdf'];
const names = (files: string[]) => files.map((f) => new URL(f).pathname).sort();

test('links: quotes, relative, <base>, entities, and no mailto/fragment-only links', () => {
  const links = linksIn('<base href="https://h.test/x/"><a href="a.zip">a</a><a href=\'/b.zip\'>b</a><a href=c.zip?q=1&amp;r=2#f>c</a><a href="mailto:a@b">m</a><a href="#t">t</a>', 'https://h.test/page');
  assert.deepEqual(links.map((u) => u.href), ['https://h.test/x/a.zip', 'https://h.test/b.zip', 'https://h.test/x/c.zip?q=1&r=2']);
});

test('depth 0 reads only the start page; files on another host are kept', async () => {
  const m = makeManager();
  const r = await m.grab({ url: `${base}/`, depth: 0, sameSite: true, extensions: EXTS });
  assert.deepEqual(names(r.files), ['/a.zip', '/cdn.mp4']);
  assert.equal(r.pages, 1);
  assert.equal(r.truncated, false);
  await m.shutdown();
});

test('deeper levels follow pages on the same site only, each page once', async () => {
  const m = makeManager();
  const events: EngineEvent[] = [];
  m.on('event', (e: EngineEvent) => events.push(e));
  const one = await m.grab({ id: 'g1', url: `${base}/`, depth: 1, sameSite: true, extensions: EXTS });
  assert.deepEqual(names(one.files), ['/a.zip', '/cdn.mp4', '/files/b.mp4']);
  assert.equal(one.pages, 3, 'start, index.html, page2 (not the other site)');
  assert.ok(one.files.some((f) => f.endsWith('/files/b.mp4?x=1&y=2')));

  const two = await m.grab({ url: `${base}/`, depth: 2, sameSite: true, extensions: ['pdf'] });
  assert.deepEqual(names(two.files), ['/docs/deep/c.pdf']);

  const anySite = await m.grab({ url: `${base}/`, depth: 1, sameSite: false, extensions: ['zip'] });
  assert.deepEqual(names(anySite.files), ['/a.zip', '/far.zip']);
  assert.ok(events.some((e) => e.type === 'grab' && e.id === 'g1'), 'progress events');
  await m.shutdown();
});

test('a crawl can be stopped and returns what it found', async () => {
  const m = makeManager();
  const running = m.grab({ id: 'slow', url: `${base}/slow/0`, depth: 3, sameSite: true, extensions: EXTS });
  await new Promise((r) => setTimeout(r, 400));
  m.stopGrab('slow');
  const r = await running;
  assert.equal(r.stopped, true);
  assert.ok(slowHits < 15, `pages fetched after stopping: ${slowHits}`);
  await m.shutdown();
});

test('bad requests', async () => {
  const m = makeManager();
  await assert.rejects(m.grab({ url: 'ftp://example.com/', depth: 1, sameSite: true, extensions: EXTS }), /web page/);
  await assert.rejects(m.grab({ url: `${base}/`, depth: 1, sameSite: true, extensions: [] }), /file type/);
  await m.shutdown();
});
