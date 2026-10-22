// Launchers:
//   browser      engine (tsx watch, port 7310, token "dev") + Vite; open http://localhost:5173
//   desktop-dev  Vite + Electron loading it (Electron starts its own engine from engine/dist, rebuilt first)
//   desktop      Electron on the built UI (run `npm run build` first; `npm start` does both)
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

function electronBinary() {
  return createRequire(join(root, 'desktop', 'package.json'))('electron');
}

process.on('SIGINT', () => {
  for (const c of children) c.kill();
  process.exit(0);
});

if (mode === 'browser') {
  run('npm', ['--prefix', 'engine', 'run', 'dev']);
  run('npm', ['--prefix', 'ui', 'run', 'dev']);
  await waitForPort(5173);
  console.log('\n  Grabbit UI: http://localhost:5173  (engine on 127.0.0.1:7310)\n');
} else if (mode === 'desktop-dev') {
  npm(['--prefix', 'engine', 'run', 'bundle']);
  npm(['--prefix', 'desktop', 'run', 'bundle']);
  run('npm', ['--prefix', 'ui', 'run', 'dev']);
  await waitForPort(5173);
  run(electronBinary(), ['.'], { cwd: join(root, 'desktop'), shell: false, env: { ...process.env, GRABBIT_DEV_URL: 'http://localhost:5173' } });
} else if (mode === 'desktop') {
  run(electronBinary(), ['.'], { cwd: join(root, 'desktop'), shell: false });
} else {
  console.error(`unknown mode ${mode}: browser | desktop-dev | desktop`);
  process.exit(1);
}
