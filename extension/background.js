// Grabbit browser integration (IDM-style): a "Download with Grabbit" link menu, and browser downloads of the file types
// Grabbit captures are cancelled here and handed to the app, cookies included so signed-in downloads still work.
const ENGINE = 'http://127.0.0.1:7310';
const HEADER = { 'Content-Type': 'application/json', 'X-Grabbit-Capture': '1' };

async function enabled() {
  const { captureEnabled = true } = await chrome.storage.local.get('captureEnabled');
  return captureEnabled;
}

/** Engine status and its capture extensions; null when Grabbit is not running. */
async function engineInfo() {
  try {
    const r = await fetch(`${ENGINE}/capture`, { method: 'GET' });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

async function cookieHeader(url) {
  try {
    const cookies = await chrome.cookies.getAll({ url });
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  } catch {
    return '';
  }
}

async function sendToGrabbit(url, { referer, fileName } = {}) {
  const cookie = await cookieHeader(url);
  const headers = cookie ? { Cookie: cookie } : undefined;
  const r = await fetch(`${ENGINE}/capture`, { method: 'POST', headers: HEADER, body: JSON.stringify({ url, referer, fileName, headers }) });
  if (!r.ok) throw new Error(`Grabbit refused the link (${r.status})`);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'grabbit-link', title: 'Download with Grabbit', contexts: ['link', 'video', 'audio'] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.linkUrl || info.srcUrl;
  if (!url) return;
  try {
    await sendToGrabbit(url, { referer: tab?.url });
  } catch {
    // Grabbit is not running: let the browser handle it.
    chrome.downloads.download({ url });
  }
});

function extensionOf(name) {
  const base = (name || '').split(/[\\/]/).pop().split('?')[0];
  return base.includes('.') ? base.split('.').pop().toLowerCase() : '';
}

// Take over matching browser downloads. Blob/data URLs and tiny files stay with the browser.
chrome.downloads.onCreated.addListener(async (item) => {
  if (!(await enabled())) return;
  if (!/^https?:/i.test(item.finalUrl || item.url)) return;
  if (item.fileSize > 0 && item.fileSize < 64 * 1024) return;
  const info = await engineInfo();
  if (!info) return;
  const url = item.finalUrl || item.url;
  const ext = extensionOf(item.filename) || extensionOf(new URL(url).pathname);
  if (!info.extensions?.includes(ext)) return;
  try {
    await chrome.downloads.cancel(item.id);
    await chrome.downloads.erase({ id: item.id });
    await sendToGrabbit(url, { referer: item.referrer, fileName: item.filename ? item.filename.split(/[\\/]/).pop() : undefined });
  } catch {
    chrome.downloads.download({ url });
  }
});
