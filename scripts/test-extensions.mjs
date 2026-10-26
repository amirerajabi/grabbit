// Loads the browser extensions into the browsers installed on this machine and exercises them against a private engine:
//
//   node scripts/test-extensions.mjs [chrome] [edge] [firefox]     (default: every browser that is installed)
//
// Each browser runs headless in a throwaway profile; the user's own browser windows, their installed Grabbit (which
// holds port 7310) and their downloads are never touched. The script starts its own test file server (7400) and its
// own engine (random port, temporary data and download folders), builds the extensions, and tests copies whose engine
// address points at that engine.
//
//   Chrome   CDP over --remote-debugging-pipe; Extensions.loadUnpacked (branded Chrome ignores --load-extension).
//   Edge     CDP over a TCP port with --load-extension (Edge's launcher hands off and drops the pipe).
//   Firefox  WebDriver BiDi; webExtension.install as a temporary add-on. BiDi cannot click context menus, so Firefox
//            covers install + download takeover; the menu code is shared with Chromium.
//
// Override browser locations with CHROME_PATH, EDGE_PATH, FIREFOX_PATH.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = 'http://127.0.0.1:7400';
const PAGE = `${FILES}/page`;
const win = process.platform === 'win32';

const BROWSERS = {
  chrome: process.env.CHROME_PATH ?? first(
    win ? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe')]
      : ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
  ),
  edge: process.env.EDGE_PATH ?? first(
    win ? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
      : ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/usr/bin/microsoft-edge'],
  ),
  firefox: process.env.FIREFOX_PATH ?? first(
    win ? ['C:/Program Files/Mozilla Firefox/firefox.exe', 'C:/Program Files (x86)/Mozilla Firefox/firefox.exe']
      : ['/Applications/Firefox.app/Contents/MacOS/firefox', '/usr/bin/firefox'],
  ),
};

function first(paths) {
  return paths.find((p) => fs.existsSync(p)) ?? null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'grabbit-ext-test-'));
const children = [];

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function waitFor(fn, ms, step = 250) {
  for (let t = 0; t < ms; t += step) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await sleep(step);
  }
  return null;
}

// ------------------------------------------------------------------ fixtures: file server, engine, extension copies

async function startFixtures() {
  const up = () => fetch(PAGE).then((r) => r.ok);
  if (!(await up().catch(() => false))) {
    children.push(spawn(process.execPath, [path.join(root, 'scripts', 'test-server.mjs')], { stdio: 'ignore' }));
    if (!(await waitFor(up, 10_000))) throw new Error('test server did not start on 7400 (is something else using it?)');
  }

  const port = await freePort();
  const tsx = path.join(root, 'engine', 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const engine = spawn(process.execPath, [tsx, path.join(root, 'engine', 'src', 'index.ts'), '--port', String(port), '--token', 'test', '--data-dir', path.join(work, 'engine-data')], {
    stdio: 'ignore',
    // Nothing here may fetch yt-dlp from GitHub: a video request then fails fast instead.
    env: { ...process.env, GRABBIT_TOOLS_API: 'http://127.0.0.1:9' },
  });
  children.push(engine);
  const engineUrl = `http://127.0.0.1:${port}`;
  const ok = await waitFor(() => fetch(`${engineUrl}/api/state`, { headers: { Authorization: 'Bearer test' } }).then((r) => r.ok), 20_000);
  if (!ok) throw new Error('engine did not start');
  // Grabbit's own downloads (from the takeover and link tests) go to the scratch folder, never the user's Downloads.
  await fetch(`${engineUrl}/api/settings`, {
    method: 'PUT',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ downloadDir: path.join(work, 'grabbit-downloads') }),
  });

  const built = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-extensions.mjs')], { encoding: 'utf8' });
  if (built.status !== 0) throw new Error(`build-extensions failed:\n${built.stderr}`);
  return engineUrl;
}

/** A copy of the built extension that talks to the test engine instead of 127.0.0.1:7310. */
function extensionCopy(browser, engineUrl) {
  const dir = path.join(work, `ext-${browser}`);
  fs.cpSync(path.join(root, 'extension', 'dist', browser), dir, { recursive: true });
  for (const f of ['background.js', 'popup.js']) {
    const p = path.join(dir, f);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('http://127.0.0.1:7310', engineUrl));
  }
  return dir;
}

function engineApi(engineUrl) {
  return async () => new Set((await fetch(`${engineUrl}/api/state`, { headers: { Authorization: 'Bearer test' } }).then((r) => r.json())).downloads.map((d) => d.fileName));
}

// ------------------------------------------------------------------ Chromium (Chrome, Edge) over CDP

function cdpClient(write) {
  let nextId = 0;
  const pending = new Map();
  return {
    onMessage(msg) {
      const p = msg.id && pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    },
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
  };
}

async function launchChrome(exe, profile) {
  const child = spawn(exe, ['--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], {
    stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  const cdp = cdpClient((s) => child.stdio[3].write(`${s}\0`));
  let buf = '';
  child.stdio[4].on('data', (d) => {
    buf += d;
    for (let i; (i = buf.indexOf('\0')) >= 0; ) {
      cdp.onMessage(JSON.parse(buf.slice(0, i)));
      buf = buf.slice(i + 1);
    }
  });
  return { cdp, close: () => child.kill() };
}

async function launchEdge(exe, profile, extDir) {
  const port = await freePort();
  const child = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', `--load-extension=${extDir}`, 'about:blank'], { stdio: 'ignore' });
  children.push(child);
  const info = await waitFor(() => fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()), 20_000);
  if (!info) throw new Error('Edge did not open its debugging port');
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  const cdp = cdpClient((s) => ws.send(s));
  ws.onmessage = (m) => cdp.onMessage(JSON.parse(m.data));
  return { cdp, close: () => ws.close() };
}

async function testChromium(browser, exe, engineUrl, check) {
  const profile = path.join(work, `${browser}-profile`);
  const browserDownloads = path.join(work, `${browser}-browser-downloads`);
  fs.mkdirSync(browserDownloads, { recursive: true });
  const ext = extensionCopy(browser, engineUrl);
  const names = engineApi(engineUrl);
  const b = browser === 'edge' ? await launchEdge(exe, profile, ext) : await launchChrome(exe, profile);
  const { send } = b.cdp;
  try {
    const { product } = await send('Browser.getVersion');
    let id = null;
    if (browser === 'chrome') id = (await send('Extensions.loadUnpacked', { path: ext })).id;
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: browserDownloads, eventsEnabled: true });

    // Find our service worker (Edge also runs built-in extensions: ask each one for its manifest name).
    let session = null;
    for (let t = 0; t < 40 && !session; t++) {
      const { targetInfos } = await send('Target.getTargets');
      for (const target of targetInfos.filter((x) => x.type === 'service_worker' && x.url.endsWith('/background.js') && (!id || x.url.includes(id)))) {
        const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
        const r = await send('Runtime.evaluate', { expression: 'chrome.runtime.getManifest().name', returnByValue: true }, sessionId);
        if (r.result.value === 'Grabbit') {
          session = sessionId;
          id = new URL(target.url).host;
          break;
        }
      }
      if (!session) await sleep(250);
    }
    check('extension loads and its service worker starts', !!session, `${product}, id ${id}`);
    if (!session) return;
    const evalSw = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };

    const menus = await evalSw(`new Promise((r) => chrome.contextMenus.removeAll(() => { createMenus(); setTimeout(() => r('ok'), 300); }))`);
    check('context menus are created', menus === 'ok');
    const info = await evalSw('engineInfo()');
    check('extension reaches the engine', !!info?.extensions?.length, info ? `engine ${info.version}` : 'engineInfo() returned null');

    await evalSw(`sendToGrabbit('${FILES}/files/${browser}-link.zip?mb=2', { referer: '${PAGE}' })`);
    check('"Download with Grabbit" sends the link', !!(await waitFor(async () => (await names()).has(`${browser}-link.zip`), 5000)));

    const video = await evalSw(`post({ url: '${PAGE}', referer: '${PAGE}', video: true })`);
    check('"Download video with Grabbit" reaches the engine', typeof video?.id === 'string', JSON.stringify(video));

    const { targetId } = await send('Target.createTarget', { url: PAGE });
    await sleep(1500);
    const before = await names();
    const sent = await evalSw(`(async () => {
      const [tab] = await chrome.tabs.query({ url: '${PAGE}*' });
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectLinks, args: [false] });
      const urls = [...new Set(r.result)];
      await post({ urls, referer: tab.url });
      return urls.length;
    })()`);
    await sleep(1500);
    const added = [...(await names())].filter((n) => !before.has(n));
    check('"Download all links" collects the page links', sent === 7, `${sent} links`);
    check('with no window open, only file links are queued', added.length === 5 && added.every((n) => /\.(exe|zip|pdf|mp4|mp3)$/.test(n)), added.join(', '));

    const { sessionId: page } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, page);
    await send('Page.navigate', { url: `${FILES}/files/${browser}-takeover.iso?mb=20` }, page);
    const taken = await waitFor(async () => (await names()).has(`${browser}-takeover.iso`), 10_000);
    await sleep(1500);
    const left = fs.readdirSync(browserDownloads).filter((f) => f.includes('takeover'));
    check('a browser download is taken over by Grabbit', !!taken);
    check('the browser keeps no copy', left.length === 0, left.join(', '));
  } finally {
    b.close();
  }
}

// ------------------------------------------------------------------ Firefox over WebDriver BiDi

async function testFirefox(exe, engineUrl, check) {
  const profile = path.join(work, 'firefox-profile');
  const browserDownloads = path.join(work, 'firefox-browser-downloads');
  fs.mkdirSync(profile, { recursive: true });
  fs.mkdirSync(browserDownloads, { recursive: true });
  const pref = (k, v) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`;
  fs.writeFileSync(
    path.join(profile, 'user.js'),
    [
      pref('browser.download.dir', browserDownloads),
      pref('browser.download.folderList', 2),
      pref('browser.download.useDownloadDir', true),
      pref('browser.download.always_ask_before_handling_new_types', false),
      pref('browser.shell.checkDefaultBrowser', false),
      pref('datareporting.policy.dataSubmissionEnabled', false),
    ].join('\n'),
  );
  const ext = extensionCopy('firefox', engineUrl);
  const names = engineApi(engineUrl);
  const port = await freePort();
  const child = spawn(exe, ['-headless', '-no-remote', '-profile', profile, '--remote-debugging-port', String(port)], { stdio: 'ignore' });
  children.push(child);
  let ws = null;
  try {
    ws = await waitFor(async () => {
      const s = new WebSocket(`ws://127.0.0.1:${port}/session`);
      await new Promise((ok, bad) => ((s.onopen = ok), (s.onerror = bad)));
      return s;
    }, 30_000, 500);
    if (!ws) throw new Error('Firefox did not open WebDriver BiDi');
    let nextId = 0;
    const pending = new Map();
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      const p = msg.id && pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      msg.type === 'error' ? p.reject(new Error(`${msg.error}: ${msg.message}`)) : p.resolve(msg.result);
    };
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });

    const s = await send('session.new', { capabilities: {} });
    const installed = await send('webExtension.install', { extensionData: { type: 'path', path: ext } });
    check('extension installs as a temporary add-on', installed.extension === 'grabbit@amirerajabi.github.io', `Firefox ${s.capabilities.browserVersion}`);
    await sleep(1500);
    const { contexts } = await send('browsingContext.getTree', {});
    const context = contexts[0].context;
    await send('browsingContext.navigate', { context, url: PAGE, wait: 'complete' });
    await send('browsingContext.navigate', { context, url: `${FILES}/files/firefox-takeover.iso?mb=20`, wait: 'none' }).catch(() => undefined);
    const taken = await waitFor(async () => (await names()).has('firefox-takeover.iso'), 15_000, 500);
    await sleep(2000);
    const left = fs.readdirSync(browserDownloads).filter((f) => f.includes('takeover'));
    check('a browser download is taken over by Grabbit', !!taken);
    check('the browser keeps no copy', left.length === 0, left.join(', '));
    await send('session.end', {}).catch(() => undefined);
  } finally {
    ws?.close();
    child.kill();
  }
}

// ------------------------------------------------------------------ main

const wanted = process.argv.slice(2).filter((a) => a in BROWSERS);
const targets = wanted.length ? wanted : Object.keys(BROWSERS);
let failed = 0;
try {
  const engineUrl = await startFixtures();
  for (const browser of targets) {
    const exe = BROWSERS[browser];
    console.log(`\n${browser}`);
    if (!exe) {
      console.log('  SKIP  not installed (set the path with ' + `${browser.toUpperCase()}_PATH)`);
      continue;
    }
    const check = (name, ok, detail = '') => {
      if (!ok) failed++;
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
    };
    try {
      if (browser === 'firefox') await testFirefox(exe, engineUrl, check);
      else await testChromium(browser, exe, engineUrl, check);
    } catch (e) {
      check('harness', false, e.message);
    }
  }
} catch (e) {
  console.error(e.message);
  failed++;
} finally {
  for (const c of children) c.kill();
  // Browsers' helper processes can outlive the parent for a moment; only ours use the work folder.
  await sleep(1500);
  if (win) {
    spawnSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${path.basename(work)}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`]);
  }
  await sleep(500);
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
