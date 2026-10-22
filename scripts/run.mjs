// Launchers:
//   browser      engine (tsx watch, token "dev") + Vite; open http://localhost:5173. The engine takes 7310, or a free
//                port when an installed Grabbit holds 7310, and Vite is told which (VITE_ENGINE_URL).
//   desktop-dev  Vite + Electron loading it (Electron starts its own engine from engine/dist, rebuilt first)
//   desktop      Electron on the built UI (run `npm run build` first; `npm start` does both)
// Development state lives in .dev-data/: the engine's data in browser mode, and a separate Electron profile
// (.dev-data/desktop) in the desktop modes, so a dev window never shares the installed app's profile, download list or
// single-instance lock.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] ?? 'browser';
const win = process.platform === 'win32';
const children = [];

function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: 'inherit', shell: win, cwd: root, ...opts });
  children.push(child);
  child.on('exit', (code) => {
    // One part exiting ends the session.
    for (const c of children) if (c !== child && c.exitCode === null) c.kill();
    process.exitCode = code ?? 0;
  });
  return child;
}

function npm(args, opts) {
  const r = spawnSync('npm', args, { stdio: 'inherit', shell: win, cwd: root, ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function waitForPort(port, timeoutMs = 60000) {
  const until = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const s = net.connect(port, '127.0.0.1');
      s.once('connect', () => (s.destroy(), resolve()));
      s.once('error', () => {
        s.destroy();
        if (Date.now() > until) reject(new Error(`port ${port} did not open`));
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const devProfile = { ...process.env, GRABBIT_USER_DATA: process.env.GRABBIT_USER_DATA ?? join(root, '.dev-data', 'desktop') };

function electronBinary() {
  return createRequire(join(root, 'desktop', 'package.json'))('electron');
}

process.on('SIGINT', () => {
  for (const c of children) c.kill();
  process.exit(0);
});

if (mode === 'browser') {
  const port = (await portIsFree(7310)) ? 7310 : await freePort();
  if (port !== 7310) console.log(`\n  Port 7310 is in use (an installed Grabbit?): the dev engine uses ${port} instead.\n`);
  run('npx', ['tsx', 'watch', 'src/index.ts', '--port', String(port), '--token', 'dev', '--data-dir', '../.dev-data'], { cwd: join(root, 'engine') });
  run('npm', ['--prefix', 'ui', 'run', 'dev'], { env: { ...process.env, VITE_ENGINE_URL: `http://127.0.0.1:${port}` } });
  await waitForPort(5173);
  console.log(`\n  Grabbit UI: http://localhost:5173  (engine on 127.0.0.1:${port}, token "dev")\n`);
} else if (mode === 'desktop-dev') {
  npm(['--prefix', 'engine', 'run', 'bundle']);
  npm(['--prefix', 'desktop', 'run', 'bundle']);
  run('npm', ['--prefix', 'ui', 'run', 'dev']);
  await waitForPort(5173);
  run(electronBinary(), ['.'], { cwd: join(root, 'desktop'), shell: false, env: { ...devProfile, GRABBIT_DEV_URL: 'http://localhost:5173' } });
} else if (mode === 'desktop') {
  run(electronBinary(), ['.'], { cwd: join(root, 'desktop'), shell: false, env: devProfile });
} else {
  console.error(`unknown mode ${mode}: browser | desktop-dev | desktop`);
  process.exit(1);
}
