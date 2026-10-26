// Saved site logins (and archive passwords), encrypted on disk with AES-256-GCM. The key comes from the desktop app
// (GRABBIT_SECRET_KEY, which it keeps in the OS's protected storage: DPAPI on Windows, the Keychain on macOS); without
// it (development, the browser build) a key file next to the data is used. Passwords never leave the engine through the
// API: listings show the site and the username only.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SiteLogin } from '../../../shared/protocol';
import { newId } from './util';

interface StoredLogin extends SiteLogin {
  password: string;
}

interface Vault {
  logins: StoredLogin[];
  archivePasswords: { id: string; password: string; addedAt: number }[];
}

export interface Credentials {
  username: string;
  password: string;
}

/** "host", ".example.com" / "*.example.com" (the domain and its subdomains); ports are ignored. */
export function normalizeSite(text: string): string {
  let t = text.trim().toLowerCase();
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//.test(t)) t = new URL(t).hostname;
  } catch {
    /* not a URL: a plain host pattern */
  }
  t = t.replace(/\/.*$/, '').replace(/:\d+$/, '');
  if (t.startsWith('*.')) t = t.slice(1);
  return t;
}

export function siteMatches(pattern: string, host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return pattern.startsWith('.') ? h === pattern.slice(1) || h.endsWith(pattern) : h === pattern;
}

export class SecretStore {
  private key: Buffer;
  private vault: Vault = { logins: [], archivePasswords: [] };
  private readonly file: string;
  private writing: Promise<void> = Promise.resolve();

  constructor(dataDir: string, keyHex = process.env.GRABBIT_SECRET_KEY) {
    this.file = path.join(dataDir, 'secrets.enc');
    this.key = keyHex && /^[0-9a-f]{64}$/i.test(keyHex) ? Buffer.from(keyHex, 'hex') : this.localKey(dataDir);
  }

  /** Fallback key for runs without the desktop app: a random key in a file only this user can read. */
  private localKey(dataDir: string): Buffer {
    const keyFile = path.join(dataDir, 'secret.key');
    try {
      const k = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex');
      if (k.length === 32) return k;
    } catch {
      /* first run */
    }
    const k = randomBytes(32);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(keyFile, k.toString('hex'), { mode: 0o600 });
    return k;
  }

  load(): void {
    try {
      const raw = fs.readFileSync(this.file);
      // iv (12) | tag (16) | ciphertext
      const d = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
      d.setAuthTag(raw.subarray(12, 28));
      const json = Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
      const v = JSON.parse(json) as Partial<Vault>;
      this.vault = { logins: v.logins ?? [], archivePasswords: v.archivePasswords ?? [] };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        // A different key (another machine, a reinstall without the old key): the saved logins can't be read.
        console.error('saved logins could not be decrypted; starting with none');
      }
    }
  }

  private save(): Promise<void> {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([c.update(JSON.stringify(this.vault), 'utf8'), c.final()]);
    const data = Buffer.concat([iv, c.getAuthTag(), body]);
    // Chained, and written to a temp file then renamed, so a crash never leaves a half-written vault.
    this.writing = this.writing
      .then(async () => {
        const tmp = `${this.file}.${process.pid}.tmp`;
        await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
        await fs.promises.writeFile(tmp, data, { mode: 0o600 });
        await fs.promises.rename(tmp, this.file);
      })
      .catch((e) => console.error('saving logins failed', e));
    return this.writing;
  }

  flush(): Promise<void> {
    return this.writing;
  }

  // ------------------------------------------------------------------ site logins

  list(): SiteLogin[] {
    return this.vault.logins.map(({ id, site, username, addedAt }) => ({ id, site, username, addedAt }));
  }

  add(siteText: string, username: string, password: string): SiteLogin {
    const site = normalizeSite(siteText);
    if (!site || site === '.') throw new Error('Enter the site, for example files.example.com');
    if (!username) throw new Error('Enter the username');
    // One login per site and username: saving again replaces the password.
    this.vault.logins = this.vault.logins.filter((l) => !(l.site === site && l.username === username));
    const login: StoredLogin = { id: newId(), site, username, password, addedAt: Date.now() };
    this.vault.logins.push(login);
    void this.save();
    return { id: login.id, site, username, addedAt: login.addedAt };
  }

  remove(id: string): void {
    this.vault.logins = this.vault.logins.filter((l) => l.id !== id);
    void this.save();
  }

  /** The login for a host: an exact site beats a domain pattern, the newest wins among equals. */
  lookup(host: string): Credentials | null {
    const matches = this.vault.logins.filter((l) => siteMatches(l.site, host));
    if (matches.length === 0) return null;
    matches.sort((a, b) => Number(b.site === host) - Number(a.site === host) || b.addedAt - a.addedAt);
    return { username: matches[0].username, password: matches[0].password };
  }

  // ------------------------------------------------------------------ archive passwords

  archivePasswordCount(): number {
    return this.vault.archivePasswords.length;
  }

  archivePasswords(): string[] {
    return this.vault.archivePasswords.map((p) => p.password);
  }

  addArchivePassword(password: string): void {
    if (!password) throw new Error('Enter the password');
    if (this.vault.archivePasswords.some((p) => p.password === password)) return;
    this.vault.archivePasswords.push({ id: newId(), password, addedAt: Date.now() });
    void this.save();
  }

  clearArchivePasswords(): void {
    this.vault.archivePasswords = [];
    void this.save();
  }
}
