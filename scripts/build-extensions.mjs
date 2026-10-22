// Builds the browser extension for Chrome, Edge and Firefox from extension/src, one manifest per browser, versioned
// like the app (desktop/package.json):
//
//   extension/dist/<browser>/                      unpacked, for "Load unpacked" / about:debugging
//   extension/dist/grabbit-<browser>-<v>.zip       the package each store takes (Firefox's is also a valid .xpi)
//
// `node scripts/build-extensions.mjs [outDir]` copies the packages to outDir too (the release workflow uses it).
import { copyFileSync, cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'extension', 'src');
const dist = join(root, 'extension', 'dist');
const version = JSON.parse(readFileSync(join(root, 'desktop', 'package.json'), 'utf8')).version;

const base = {
  manifest_version: 3,
  name: 'Grabbit',
  version,
  description: 'Send links and downloads to the Grabbit download manager: faster, resumable, multi-connection downloads.',
  homepage_url: 'https://github.com/amirerajabi/grabbit',
  permissions: ['contextMenus', 'downloads', 'cookies', 'storage', 'scripting', 'activeTab'],
  host_permissions: ['<all_urls>'],
  action: { default_popup: 'popup.html', default_title: 'Grabbit', default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' } },
  icons: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
};

const chromium = { ...base, background: { service_worker: 'background.js' }, minimum_chrome_version: '110' };

const TARGETS = {
  chrome: chromium,
  edge: chromium,
  firefox: {
    ...base,
    // Firefox runs MV3 background scripts as an event page, not a service worker.
    background: { scripts: ['background.js'] },
    browser_specific_settings: {
      gecko: {
        id: 'grabbit@amirerajabi.github.io',
        strict_min_version: '140.0',
        // Nothing is sent to the developer or third parties: links and cookies only go to the app on this computer.
        data_collection_permissions: { required: ['none'] },
      },
    },
  },
};

// ------------------------------------------------------------------ minimal zip writer (deflate, no dependencies)

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const v of buf) c = CRC[(c ^ v) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0, 10); // time/date: fixed, so builds are reproducible
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, deflated);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + deflated.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function listFiles(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

// ------------------------------------------------------------------ build

const outDir = process.argv[2];
rmSync(dist, { recursive: true, force: true });
for (const [browser, manifest] of Object.entries(TARGETS)) {
  const dir = join(dist, browser);
  cpSync(src, dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const files = listFiles(dir)
    .map((p) => ({ name: relative(dir, p).split('\\').join('/'), data: readFileSync(p) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const pkg = join(dist, `grabbit-${browser}-${version}.zip`);
  writeFileSync(pkg, zip(files));
  console.log(`${browser}: ${relative(root, pkg)} (${files.length} files)`);
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    copyFileSync(pkg, join(outDir, `Grabbit-Extension-${browser[0].toUpperCase()}${browser.slice(1)}-${version}.zip`));
  }
}
