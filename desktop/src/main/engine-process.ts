// The download engine runs as an Electron utility process (Node without a window), like Rowlit's .NET sidecar: the
// UI talks to it over HTTP + WebSocket with a per-launch token, so downloads keep going while the window is closed.
import { utilityProcess, type UtilityProcess } from 'electron';
import { randomBytes } from 'node:crypto';
import { dataDir, engineEntry } from './paths';
import { secretKey } from './secret-key';

export interface EngineInfo {
  url: string;
  token: string;
  port: number;
}

/** The usual port, so the browser extension can find the engine; a busy port falls back to a random one. */
const PREFERRED_PORT = 7310;

let child: UtilityProcess | null = null;

export function startEngine(): Promise<EngineInfo> {
  const token = randomBytes(24).toString('hex');
  return new Promise((resolve, reject) => {
    const proc = utilityProcess.fork(engineEntry(), ['--port', String(PREFERRED_PORT), '--token', token, '--data-dir', dataDir()], {
      serviceName: 'Grabbit engine',
      stdio: 'pipe',
      // The logins key goes by environment, not on the command line where other programs could read it.
      env: { ...process.env, GRABBIT_SECRET_KEY: secretKey() },
    });
    child = proc;
    const timer = setTimeout(() => reject(new Error('The download engine did not start within 15 seconds')), 15_000);
    proc.stdout?.on('data', (d: Buffer) => process.stdout.write(`[engine] ${d}`));
    proc.stderr?.on('data', (d: Buffer) => process.stderr.write(`[engine] ${d}`));
    proc.on('message', (m: { type?: string; port?: number }) => {
      if (m?.type !== 'ready' || typeof m.port !== 'number') return;
      clearTimeout(timer);
      resolve({ url: `http://127.0.0.1:${m.port}`, token, port: m.port });
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (child === proc) child = null;
      reject(new Error(`The download engine exited (code ${code})`));
    });
  });
}

/** Ask the engine to pause and save everything, then make sure it is gone. */
export function stopEngine(): Promise<void> {
  const proc = child;
  if (!proc) return Promise.resolve();
  return new Promise((resolve) => {
    const kill = setTimeout(() => {
      proc.kill();
      resolve();
    }, 5000);
    proc.once('exit', () => {
      clearTimeout(kill);
      resolve();
    });
    proc.postMessage({ type: 'shutdown' });
  });
}
