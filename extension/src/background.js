// Grabbit browser integration (IDM-style), one source for Chrome, Edge and Firefox (scripts/build-extensions.mjs writes
// a manifest per browser). It adds the link menu items "Download with Grabbit", "Download selected links with Grabbit"
// and "Download all links with Grabbit", and hands browser downloads of the file types Grabbit captures to the app,
// cookies included so signed-in downloads still work.
const api = globalThis.browser ?? globalThis.chrome;
const ENGINE = 'http://127.0.0.1:7310';
const HEADER = { 'Content-Type': 'application/json', 'X-Grabbit-Capture': '1' };

/** URLs we gave back to the browser ourselves (Grabbit refused them): never take those over again. */
const handBack = new Set();

async function captureEnabled() {
  const { captureEnabled = true } = await api.storage.local.get('captureEnabled');
  return captureEnabled;
}

/** Engine status and its capture extensions; null when Grabbit is not running. */
async function engineInfo() {
  try {
    const r = await fetch(`${ENGINE}/capture`, { method: 'GET', headers: { 'X-Grabbit-Capture': '1' } });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/** Cookies for `url`, so the app can fetch what needs a signed-in session. Firefox asks for site access first. */
async function cookieHeader(url) {
  try {
    const cookies = await api.cookies.getAll({ url });
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  } catch {
    return '';
  }
}

async function post(body) {
  const r = await fetch(`${ENGINE}/capture`, { method: 'POST', headers: HEADER, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Grabbit refused the request (${r.status})`);
  return r.json();
}

async function sendToGrabbit(url, { referer, fileName } = {}) {
  const cookie = await cookieHeader(url);
  return post({ url, referer, fileName, headers: cookie ? { Cookie: cookie } : undefined });
}

/** Let the browser download it after all, without taking that download over again. */
function giveBack(url) {
  handBack.add(url);
  api.downloads.download({ url });
}

/** A short-lived badge on the toolbar button: "!" when Grabbit is not running, the link count after a batch. */
async function flash(text, color) {
  try {
    await api.action.setBadgeBackgroundColor({ color });
    await api.action.setBadgeText({ text });
    setTimeout(() => api.action.setBadgeText({ text: '' }), 4000);
  } catch {
    /* no toolbar button */
  }
}

// ------------------------------------------------------------------ context menus

function createMenus() {
  api.contextMenus.removeAll(() => {
    api.contextMenus.create({ id: 'grabbit-link', title: 'Download with Grabbit', contexts: ['link', 'video', 'audio', 'image'] });
    api.contextMenus.create({ id: 'grabbit-selection', title: 'Download selected links with Grabbit', contexts: ['selection'] });
    api.contextMenus.create({ id: 'grabbit-page', title: 'Download all links with Grabbit', contexts: ['page'] });
    api.contextMenus.create({ id: 'grabbit-video', title: 'Download video with Grabbit', contexts: ['page', 'video', 'link'] });
  });
}

api.runtime.onInstalled.addListener(createMenus);
api.runtime.onStartup?.addListener(createMenus);

/** Runs inside the page: the links (and media sources) of the whole page, or only of the selection. */
function collectLinks(selectionOnly) {
  const sel = window.getSelection();
  const inScope = (el) => !selectionOnly || (sel && sel.rangeCount > 0 && sel.containsNode(el, true));
  const out = [];
  for (const a of document.querySelectorAll('a[href], area[href]')) if (inScope(a)) out.push(a.href);
  for (const m of document.querySelectorAll('video[src], audio[src], source[src]')) if (inScope(m)) out.push(m.src);
  return out.filter((u) => /^https?:/i.test(u));
}

api.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'grabbit-link') {
    const url = info.linkUrl || info.srcUrl;
    if (!url) return;
    try {
      await sendToGrabbit(url, { referer: tab?.url });
    } catch {
      flash('!', '#dc2626');
      giveBack(url); // Grabbit is not running: let the browser handle it.
    }
    return;
  }
  if (info.menuItemId === 'grabbit-video') {
    // A <video> element's source is usually a blob: stream; the page address is what yt-dlp understands.
    const url = info.linkUrl || info.pageUrl || tab?.url;
    if (!url || !/^https?:/i.test(url)) return;
    try {
      await post({ url, referer: tab?.url, video: true });
    } catch {
      flash('!', '#dc2626');
    }
    return;
  }
  if ((info.menuItemId === 'grabbit-page' || info.menuItemId === 'grabbit-selection') && tab?.id !== undefined) {
    try {
      const [res] = await api.scripting.executeScript({ target: { tabId: tab.id }, func: collectLinks, args: [info.menuItemId === 'grabbit-selection'] });
      const urls = [...new Set(res?.result ?? [])];
      if (urls.length === 0) return flash('0', '#6b7280');
      await post({ urls, referer: tab.url });
      flash(String(urls.length), '#2563eb');
    } catch {
      flash('!', '#dc2626');
    }
  }
});

// ------------------------------------------------------------------ download takeover

function extensionOf(name) {
  const base = (name || '').split(/[\\/]/).pop().split('?')[0];
  return base.includes('.') ? base.split('.').pop().toLowerCase() : '';
}

// Take over matching browser downloads. Blob/data URLs, tiny files and our own hand-backs stay with the browser.
api.downloads.onCreated.addListener(async (item) => {
  const url = item.finalUrl || item.url;
  if (handBack.delete(url) || handBack.delete(item.url)) return;
  if (!(await captureEnabled())) return;
  if (!/^https?:/i.test(url)) return;
  if (item.fileSize > 0 && item.fileSize < 64 * 1024) return;
  const info = await engineInfo();
  if (!info) return;
  let ext = extensionOf(item.filename);
  if (!ext) {
    try {
      ext = extensionOf(new URL(url).pathname);
    } catch {
      ext = '';
    }
  }
  if (!info.extensions?.includes(ext)) return;
  try {
    await api.downloads.cancel(item.id);
    await api.downloads.erase({ id: item.id });
    await sendToGrabbit(url, { referer: item.referrer, fileName: item.filename ? item.filename.split(/[\\/]/).pop() : undefined });
  } catch {
    giveBack(url);
  }
});
