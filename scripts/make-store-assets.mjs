// Renders the store images from store/src/frames.html into store/assets/ at the sizes the stores ask for:
//
//   Chrome Web Store  screenshots 1280x800, small promo tile 440x280, marquee 1400x560
//   Edge Add-ons      same screenshots and tiles, plus a 300x300 logo
//   addons.mozilla.org  the screenshots
//
// store/src/app.png and batch.png are real captures of the running app (scripts/shoot.mjs, see store/README.md).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = pathToFileURL(path.join(root, 'store', 'src', 'frames.html')).href;
const out = (name) => path.join(root, 'store', 'assets', name);

const IMAGES = [
  ['shot-menu', '1-right-click-menu.png', 1280, 800],
  ['shot-app', '2-app.png', 1280, 800],
  ['shot-batch', '3-download-all-links.png', 1280, 800],
  ['shot-popup', '4-browser-downloads.png', 1280, 800],
  ['promo-small', 'promo-small-440x280.png', 440, 280],
  ['promo-marquee', 'promo-marquee-1400x560.png', 1400, 560],
  ['logo', 'logo-300.png', 300, 300],
];

for (const [hash, file, w, h] of IMAGES) {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'shoot.mjs'), `${page}#${hash}`, out(file), String(w), String(h)], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
