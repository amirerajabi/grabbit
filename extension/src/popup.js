const api = globalThis.browser ?? globalThis.chrome;
const status = document.getElementById('status');
const capture = document.getElementById('capture');
const access = document.getElementById('access');
const ALL_SITES = { origins: ['<all_urls>'] };

document.getElementById('version').textContent = `v${api.runtime.getManifest().version}`;

api.storage.local.get('captureEnabled').then(({ captureEnabled = true }) => {
  capture.checked = captureEnabled;
});
capture.addEventListener('change', () => api.storage.local.set({ captureEnabled: capture.checked }));

// Firefox grants site access separately from installing: without it, downloads that need your sign-in fail.
api.permissions.contains(ALL_SITES).then((granted) => {
  access.hidden = granted;
});
document.getElementById('grant').addEventListener('click', async () => {
  if (await api.permissions.request(ALL_SITES)) access.hidden = true;
});

fetch('http://127.0.0.1:7310/capture', { headers: { 'X-Grabbit-Capture': '1' } })
  .then((r) => (r.ok ? r.json() : Promise.reject()))
  .then((info) => {
    status.className = 'ok';
    status.textContent = `Connected to Grabbit ${info.version}. ${info.extensions.length} file types are captured.`;
  })
  .catch(() => {
    status.className = 'bad';
    status.textContent = 'Grabbit is not running. Start the app to capture downloads.';
  });
