const status = document.getElementById('status');
const capture = document.getElementById('capture');

chrome.storage.local.get('captureEnabled').then(({ captureEnabled = true }) => {
  capture.checked = captureEnabled;
});
capture.addEventListener('change', () => chrome.storage.local.set({ captureEnabled: capture.checked }));

fetch('http://127.0.0.1:7310/capture')
  .then((r) => (r.ok ? r.json() : Promise.reject()))
  .then((info) => {
    status.className = 'ok';
    status.textContent = `Connected to Grabbit ${info.version}. ${info.extensions.length} file types are captured.`;
  })
  .catch(() => {
    status.className = 'bad';
    status.textContent = 'Grabbit is not running. Start the app to capture downloads.';
  });
