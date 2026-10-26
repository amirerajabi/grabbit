// Screenshot a page at an exact size with headless Chrome, for store images and docs:
//
//   node scripts/shoot.mjs <url> <out.png> <width> <height> [script to run in the page first]
//
// Uses the installed Chrome (or CHROME_PATH) in a throwaway profile over --remote-debugging-pipe; no dependencies.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [url, out, w, h, setup] = process.argv.slice(2);
if (!url || !out) {
  console.error('usage: node scripts/shoot.mjs <url> <out.png> <width> <height> [page script]');
  process.exit(1);
}
const exe =
  process.env.CHROME_PATH ??
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'grabbit-shot-'));
const child = spawn(exe, ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });

let id = 0;
const pending = new Map();
let buf = '';
child.stdio[4].on('data', (d) => {
  buf += d;
  for (let i; (i = buf.indexOf('\0')) >= 0; ) {
    const msg = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    }
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Emulation.setDeviceMetricsOverride', { width: Number(w) || 1280, height: Number(h) || 800, deviceScaleFactor: 1, mobile: false }, sessionId);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Page.navigate', { url }, sessionId);
  await sleep(url.startsWith("file:") ? 800 : 3000);
  if (setup) {
    const r = await send('Runtime.evaluate', { expression: setup, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    if (r.result.value !== undefined) console.log('page:', JSON.stringify(r.result.value));
    await sleep(1500);
  }
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, Buffer.from(data, 'base64'));
  console.log(`wrote ${out}`);
} finally {
  child.kill();
  await sleep(500);
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
