// SFTP downloads over SSH (the ssh2 library): stat for the size, ranged reads for resume and segments (each segment is
// its own SSH connection). Logins: a saved one or user:pass in the address; without a password, the SSH agent and the
// usual key files (~/.ssh/id_ed25519, id_ecdsa, id_rsa, unencrypted ones) are tried. The server's host key is trusted on
// first use and checked afterwards, like ssh's known_hosts. ssh2's optional native add-ons (sshcrypto.node,
// cpu-features), which npm compiles on Linux and macOS, are left out of the bundle (`bundle` in package.json); ssh2
// loads them in a try/catch and uses its JavaScript ciphers without them.
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Readable } from 'node:stream';
import ssh2, { type Client, type ConnectConfig, type SFTPWrapper } from 'ssh2';
import { AuthError, HttpError } from '../http';
import { proxyFor, tunnel } from '../proxy';

type Login = { username: string; password: string } | null;

/** host:port → SHA-256 fingerprint of the key the server showed the first time. */
class KnownHosts {
  private map: Record<string, string> = {};
  constructor(private readonly file: string) {
    try {
      this.map = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
    } catch {
      /* none yet */
    }
  }
  check(id: string, key: Buffer): boolean {
    const fp = createHash('sha256').update(key).digest('base64');
    const known = this.map[id];
    if (known) return known === fp;
    this.map[id] = fp;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.map, null, 2));
    } catch {
      /* keep it in memory */
    }
    return true;
  }
}

let knownHosts: KnownHosts | null = null;
export function setKnownHostsFile(file: string): void {
  knownHosts = new KnownHosts(file);
}

function defaultKey(): Buffer | undefined {
  for (const name of ['id_ed25519', 'id_ecdsa', 'id_rsa']) {
    try {
      const k = fs.readFileSync(path.join(os.homedir(), '.ssh', name));
      // An encrypted key needs its passphrase, which Grabbit doesn't ask for: leave it to the agent.
      if (!/ENCRYPTED/.test(k.toString('utf8', 0, 200)) && !k.includes('bcrypt')) return k;
    } catch {
      /* not there */
    }
  }
  return undefined;
}

function agentPath(): string | undefined {
  if (process.env.SSH_AUTH_SOCK) return process.env.SSH_AUTH_SOCK;
  return process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined;
}

interface Conn {
  client: Client;
  sftp: SFTPWrapper;
}

async function connect(u: URL, creds: Login, timeoutMs: number, signal?: AbortSignal): Promise<Conn> {
  const port = Number(u.port) || 22;
  const host = u.hostname;
  const proxy = await proxyFor(u);
  const sock = proxy ? await tunnel(proxy, host, port, timeoutMs, signal) : undefined;
  const username = creds?.username ?? os.userInfo().username;
  const cfg: ConnectConfig = {
    host,
    port,
    sock,
    username,
    readyTimeout: timeoutMs,
    keepaliveInterval: 15_000,
    hostVerifier: (key: Buffer) => knownHosts?.check(`${host}:${port}`, key) ?? true,
  };
  if (creds?.password) cfg.password = creds.password;
  else {
    cfg.privateKey = defaultKey();
    cfg.agent = agentPath();
  }
  return new Promise<Conn>((resolve, reject) => {
    const client = new ssh2.Client();
    let settled = false;
    const fail = (e: Error) => {
      if (settled) return;
      settled = true;
      client.end();
      const msg = e.message ?? '';
      if ((e as { level?: string }).level === 'client-authentication' || /authentication methods failed/i.test(msg)) {
        reject(new AuthError(host, null, !!creds));
      } else if (/host.*(verif|key)/i.test(msg)) {
        reject(new HttpError(495, `${host}'s SSH host key changed since the first download from it. If the server was reinstalled, remove it from known_hosts.json in Grabbit's data folder.`));
      } else {
        reject(e);
      }
    };
    signal?.addEventListener('abort', () => fail(new Error('Stopped')), { once: true });
    client.on('error', fail);
    client.on('ready', () => {
      client.sftp((err, sftp) => {
        if (err) return fail(err);
        settled = true;
        resolve({ client, sftp });
      });
    });
    client.connect(cfg);
  });
}

export function sftpPath(u: URL): string {
  return decodeURIComponent(u.pathname) || '/';
}

export async function sftpProbe(u: URL, creds: Login, timeoutMs: number, signal?: AbortSignal): Promise<{ size: number | null; resumable: boolean }> {
  const c = await connect(u, creds, timeoutMs, signal);
  try {
    const st = await new Promise<{ size: number; isDirectory(): boolean }>((resolve, reject) => c.sftp.stat(sftpPath(u), (e, s) => (e ? reject(e) : resolve(s))));
    if (st.isDirectory()) throw new HttpError(400, 'That address is a folder, not a file');
    return { size: st.size, resumable: true };
  } catch (e) {
    if ((e as { code?: number }).code === 2) throw new HttpError(404, 'The file is not on the SFTP server');
    throw e;
  } finally {
    c.client.end();
  }
}

/** The bytes from `start` to `end` (inclusive) or to the end of the file; closing the stream closes the connection. */
export async function sftpOpen(u: URL, creds: Login, start: number, end: number | undefined, timeoutMs: number, signal?: AbortSignal): Promise<Readable> {
  const c = await connect(u, creds, timeoutMs, signal);
  const stream = c.sftp.createReadStream(sftpPath(u), { start, ...(end !== undefined ? { end } : {}), highWaterMark: 256 * 1024 });
  // A pause aborts the signal: stop reading at once, like an HTTP response does.
  const stop = () => stream.destroy(Object.assign(new Error('Stopped'), { name: 'AbortError' }));
  signal?.addEventListener('abort', stop, { once: true });
  stream.on('close', () => {
    signal?.removeEventListener('abort', stop);
    c.client.end();
  });
  stream.on('error', () => c.client.end());
  if (signal?.aborted) stop();
  return stream;
}
