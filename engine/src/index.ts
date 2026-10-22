import * as os from 'node:os';
import * as path from 'node:path';
import { DownloadManager } from './core/DownloadManager';
import { createServer } from './http/server';

/**
 * Grabbit engine. Run by the desktop app as a utility process (it passes --port, --token and --data-dir), or on its
 * own for UI development: `npm run dev` listens on 7310 with the token "dev".
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function defaultDataDir(): string {
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Grabbit');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Grabbit');
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'grabbit');
}

const port = Number(arg('port') ?? 7310);
const token = arg('token') ?? 'dev';
const dataDir = arg('data-dir') ?? defaultDataDir();

const manager = new DownloadManager(dataDir);
manager.load();
const server = createServer(manager, token);

/** Tell the parent (Electron utilityProcess) where we listen. */
function report(msg: unknown): void {
  const parentPort = (process as unknown as { parentPort?: { postMessage(m: unknown): void } }).parentPort;
  if (parentPort) parentPort.postMessage(msg);
  else if (process.send) process.send(msg);
}

server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE' && port !== 0) {
    // Someone else holds the usual port: take any free one (browser capture then needs the port from Settings).
    console.warn(`port ${port} busy, using a random port`);
    server.listen(0, '127.0.0.1');
    return;
  }
  console.error(e);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  const addr = server.address();
  const actual = typeof addr === 'object' && addr ? addr.port : port;
  console.log(`Grabbit engine listening on http://127.0.0.1:${actual} (data: ${dataDir})`);
  report({ type: 'ready', port: actual });
});

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  server.close();
  await manager.shutdown();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
(process as unknown as { parentPort?: { on(e: string, cb: (m: { data: unknown }) => void): void } }).parentPort?.on('message', (m) => {
  if ((m.data as { type?: string })?.type === 'shutdown') void shutdown();
});
