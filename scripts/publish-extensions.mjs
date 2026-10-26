// Uploads the built extensions (extension/dist, `npm run build:extensions` first) to the stores as a new version of an
// existing listing. Each store is skipped unless its credentials are set, so one store can be set up at a time.
//
//   Chrome Web Store   CWS_EXTENSION_ID, CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN
//   Firefox (AMO)      AMO_JWT_ISSUER, AMO_JWT_SECRET
//   Edge Add-ons       EDGE_PRODUCT_ID, EDGE_CLIENT_ID, EDGE_API_KEY
//
//   node scripts/publish-extensions.mjs [chrome] [firefox] [edge]     (default: every store with credentials)
//   DRY_RUN=1 node scripts/publish-extensions.mjs                     (checks packages and credentials, uploads nothing)
//
// The first version of each listing is submitted by hand on the store's website (that creates the listing and its ID,
// and is where the description, screenshots and privacy answers go; see store/README.md). This script handles every
// version after that. Stores refuse a version number they already have, so publish once per release.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'desktop', 'package.json'), 'utf8')).version;
const zip = (browser) => path.join(root, 'extension', 'dist', `grabbit-${browser}-${version}.zip`);
const dry = process.env.DRY_RUN === '1';
const env = process.env;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isWin = process.platform === 'win32';

const STORES = {
  chrome: { name: 'Chrome Web Store', vars: ['CWS_EXTENSION_ID', 'CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN'], run: publishChrome },
  firefox: { name: 'Firefox Add-ons (AMO)', vars: ['AMO_JWT_ISSUER', 'AMO_JWT_SECRET'], run: publishFirefox },
  edge: { name: 'Microsoft Edge Add-ons', vars: ['EDGE_PRODUCT_ID', 'EDGE_CLIENT_ID', 'EDGE_API_KEY'], run: publishEdge },
};

function npx(args, extraEnv = {}) {
  const r = spawnSync('npx', ['--yes', ...args], { stdio: 'inherit', shell: isWin, env: { ...env, ...extraEnv } });
  if (r.status !== 0) throw new Error(`npx ${args[0]} exited with ${r.status}`);
}

// Chrome: the maintained CLI for the Chrome Web Store API (it tracks the API's versions), upload + publish.
async function publishChrome() {
  npx(['chrome-webstore-upload-cli@3', 'upload', '--source', zip('chrome'), '--auto-publish'], {
    EXTENSION_ID: env.CWS_EXTENSION_ID,
    CLIENT_ID: env.CWS_CLIENT_ID,
    CLIENT_SECRET: env.CWS_CLIENT_SECRET,
    REFRESH_TOKEN: env.CWS_REFRESH_TOKEN,
  });
}

// Firefox: Mozilla's own tool. A listed version goes to review and is signed and published by AMO.
async function publishFirefox() {
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'grabbit-amo-'));
  try {
    npx([
      'web-ext@8', 'sign', '--channel', 'listed', '--source-dir', path.join(root, 'extension', 'dist', 'firefox'),
      '--artifacts-dir', artifacts, '--api-key', env.AMO_JWT_ISSUER, '--api-secret', env.AMO_JWT_SECRET,
      // Don't wait for the review; AMO publishes the version once it is approved.
      '--approval-timeout', '0',
    ]);
  } finally {
    fs.rmSync(artifacts, { recursive: true, force: true });
  }
}

// Edge: Add-ons API v1.1 (API key). Upload the package to the draft, wait for it to be processed, then submit.
async function publishEdge() {
  const base = `https://api.addons.microsoftedge.microsoft.com/v1/products/${env.EDGE_PRODUCT_ID}`;
  const auth = { Authorization: `ApiKey ${env.EDGE_API_KEY}`, 'X-ClientID': env.EDGE_CLIENT_ID };

  const wait = async (url, what) => {
    for (let i = 0; i < 60; i++) {
      const r = await fetch(url, { headers: auth });
      const body = await r.json().catch(() => ({}));
      if (body.status === 'Succeeded') return;
      if (body.status === 'Failed') throw new Error(`${what} failed: ${JSON.stringify(body.errors ?? body.message ?? body)}`);
      await sleep(5000);
    }
    throw new Error(`${what} did not finish in 5 minutes`);
  };

  const up = await fetch(`${base}/submissions/draft/package`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/zip' }, body: fs.readFileSync(zip('edge')) });
  if (up.status !== 202) throw new Error(`upload refused (${up.status}): ${await up.text()}`);
  await wait(`${base}/submissions/draft/package/operations/${up.headers.get('location')}`, 'Package upload');
  console.log('  package uploaded');

  const sub = await fetch(`${base}/submissions`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: `Grabbit ${version}. See https://github.com/amirerajabi/grabbit/releases/tag/v${version}` }) });
  if (sub.status !== 202) throw new Error(`submission refused (${sub.status}): ${await sub.text()}`);
  await wait(`${base}/submissions/operations/${sub.headers.get('location')}`, 'Submission');
  console.log('  submitted for review');
}

const wanted = process.argv.slice(2).filter((a) => a in STORES);
let failed = 0;
for (const id of wanted.length ? wanted : Object.keys(STORES)) {
  const s = STORES[id];
  const missing = s.vars.filter((v) => !env[v]);
  console.log(`\n${s.name}`);
  if (!fs.existsSync(zip(id))) {
    console.log(`  FAIL  ${path.relative(root, zip(id))} not found: run npm run build:extensions first`);
    failed++;
    continue;
  }
  if (missing.length) {
    console.log(`  SKIP  not set up (missing ${missing.join(', ')})`);
    continue;
  }
  if (dry) {
    console.log(`  OK    would upload ${path.basename(zip(id))} (dry run)`);
    continue;
  }
  try {
    await s.run();
    console.log(`  DONE  version ${version} sent to the ${s.name}`);
  } catch (e) {
    console.log(`  FAIL  ${e.message}`);
    failed++;
  }
}
process.exit(failed ? 1 : 0);
