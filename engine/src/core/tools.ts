// Helper programs, fetched the first time they're needed: 7-Zip (extracting archives), yt-dlp and ffmpeg (videos). A copy
// already installed on the computer is used as is (except yt-dlp, which sites break often enough that Grabbit keeps its
// own copy and updates it). Downloads come from each project's official GitHub releases, go through the proxy settings,
// and are checked against the SHA-256 the release publishes before anything is run.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ToolInfo, ToolName } from '../../../shared/protocol';
import { openRequest } from './http';
import { atomicWrite, errorMessage } from './util';

const UA = 'Grabbit (+https://github.com/amirerajabi/grabbit)';
const DAY = 24 * 60 * 60 * 1000;

interface Asset {
  name: string;
  url: string;
  size: number;
  sha256: string | null;
}

interface Release {
  version: string;
  assets: Asset[];
}

interface Installed {
  version: string;
  path: string;
  checkedAt: number;
}

const LABELS: Record<ToolName, string> = { '7zip': '7-Zip', 'yt-dlp': 'yt-dlp', ffmpeg: 'FFmpeg' };
const exe = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name);
const arm = process.arch === 'arm64';

/** First match for `name` on PATH. */
function onPath(name: string): string | null {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  // Apps started from the Dock don't get the shell's PATH, so Homebrew's folders are added by hand.
  if (process.platform === 'darwin') dirs.push('/opt/homebrew/bin', '/usr/local/bin');
  for (const d of dirs) {
    const p = path.join(d, exe(name));
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {
      /* not here */
    }
  }
  return null;
}

function run(file: string, args: string[], timeoutMs = 10 * 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${path.basename(file)} failed: ${(stderr || stdout || err.message).trim().slice(0, 400)}`));
      else resolve(stdout);
    });
  });
}

/** Recursively finds a file by name (archives put binaries in a versioned folder). */
function findFile(dir: string, name: string): string | null {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return p;
    if (e.isDirectory()) {
      const found = findFile(p, name);
      if (found) return found;
    }
  }
  return null;
}

export class ToolManager extends EventEmitter {
  private readonly dir: string;
  private readonly stateFile: string;
  private installed: Partial<Record<ToolName, Installed>> = {};
  private readonly busy = new Map<ToolName, Promise<string>>();
  private readonly live = new Map<ToolName, { received: number; size: number | null; error: string | null }>();
  private lastEmit = 0;

  /**
   * `apiBase` is GitHub's API (tests point it at a local server); `useSystem` = false ignores installed copies (tests).
   */
  constructor(
    dataDir: string,
    private readonly apiBase = process.env.GRABBIT_TOOLS_API ?? 'https://api.github.com',
    private readonly useSystem = process.env.GRABBIT_TOOLS_NO_SYSTEM !== '1',
  ) {
    super();
    this.dir = path.join(dataDir, 'tools');
    this.stateFile = path.join(this.dir, 'tools.json');
    try {
      this.installed = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as typeof this.installed;
    } catch {
      /* nothing installed yet */
    }
  }

  private systemPath(name: ToolName): string | null {
    if (!this.useSystem) return null;
    if (name === '7zip') {
      if (process.platform === 'win32') {
        for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432]) {
          const p = base && path.join(base, '7-Zip', '7z.exe');
          if (p && fs.existsSync(p)) return p;
        }
      }
      return onPath('7zz') ?? onPath('7z');
    }
    if (name === 'ffmpeg') return onPath('ffmpeg');
    return null;
  }

  private ownPath(name: ToolName): string | null {
    const i = this.installed[name];
    return i && fs.existsSync(i.path) ? i.path : null;
  }

  info(name: ToolName): ToolInfo {
    const live = this.live.get(name);
    const system = this.systemPath(name);
    const own = this.ownPath(name);
    const found = system ?? own;
    return {
      name,
      label: LABELS[name],
      state: this.busy.has(name) ? 'downloading' : found ? 'ready' : live?.error ? 'failed' : 'missing',
      source: system ? 'system' : own ? 'grabbit' : null,
      path: found,
      version: system ? null : (this.installed[name]?.version ?? null),
      received: live?.received ?? 0,
      size: live?.size ?? null,
      error: live?.error ?? null,
    };
  }

  list(): ToolInfo[] {
    return (['7zip', 'yt-dlp', 'ffmpeg'] as ToolName[]).map((n) => this.info(n));
  }

  private emitTools(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastEmit < 300) return;
    this.lastEmit = now;
    this.emit('tools', this.list());
  }

  /** The program's path, downloading it first if needed. yt-dlp is also updated when a day has passed since the last check. */
  async ensure(name: ToolName): Promise<string> {
    const system = this.systemPath(name);
    if (system) return system;
    const own = this.ownPath(name);
    const stale = name === 'yt-dlp' && own && Date.now() - (this.installed[name]?.checkedAt ?? 0) > DAY;
    if (own && !stale) return own;
    const running = this.busy.get(name);
    if (running) return running;
    const job = this.install(name, own ?? null).finally(() => {
      this.busy.delete(name);
      this.emitTools(true);
    });
    this.busy.set(name, job);
    this.emitTools(true);
    return job;
  }

  /** Removes Grabbit's own copy (a system copy is never touched). */
  remove(name: ToolName): void {
    fs.rmSync(path.join(this.dir, name), { recursive: true, force: true });
    delete this.installed[name];
    this.live.delete(name);
    this.save();
    this.emitTools(true);
  }

  private save(): void {
    void atomicWrite(this.stateFile, JSON.stringify(this.installed, null, 2)).catch(() => undefined);
  }

  private async install(name: ToolName, current: string | null): Promise<string> {
    this.live.set(name, { received: 0, size: null, error: null });
    try {
      const release = await this.release(name);
      const have = this.installed[name];
      if (current && have && have.version === release.version) {
        have.checkedAt = Date.now();
        this.save();
        return current;
      }
      const target = path.join(this.dir, name);
      const work = path.join(this.dir, `${name}.new`);
      fs.rmSync(work, { recursive: true, force: true });
      fs.mkdirSync(work, { recursive: true });
      const bin = await this.setup(name, release, work);
      // Swap the new copy in only once it's complete; a failed update leaves the old one working.
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(work, target);
      const finalPath = path.join(target, path.relative(work, bin));
      if (process.platform !== 'win32') fs.chmodSync(finalPath, 0o755);
      this.installed[name] = { version: release.version, path: finalPath, checkedAt: Date.now() };
      this.save();
      this.live.delete(name);
      return finalPath;
    } catch (e) {
      // An update check that fails (offline, rate limited) keeps the copy we have.
      if (current) {
        this.live.delete(name);
        return current;
      }
      this.live.set(name, { received: 0, size: null, error: errorMessage(e) });
      throw new Error(`Couldn't get ${LABELS[name]}: ${errorMessage(e)}`);
    } finally {
      fs.rmSync(path.join(this.dir, `${name}.new`), { recursive: true, force: true });
    }
  }

  private async getJson<T>(url: string): Promise<T> {
    const { res } = await openRequest(url, { headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' }, timeoutMs: 30_000 });
    const chunks: Buffer[] = [];
    for await (const c of res as AsyncIterable<Buffer>) chunks.push(c);
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  }

  private async githubRelease(repo: string): Promise<Release> {
    type Gh = { tag_name: string; published_at?: string; assets: { name: string; browser_download_url: string; size: number; digest?: string | null }[] };
    const r = await this.getJson<Gh>(`${this.apiBase}/repos/${repo}/releases/latest`);
    return {
      version: r.tag_name === 'latest' && r.published_at ? r.published_at.slice(0, 10) : r.tag_name,
      assets: r.assets.map((a) => ({
        name: a.name,
        url: a.browser_download_url,
        size: a.size,
        sha256: a.digest?.startsWith('sha256:') ? a.digest.slice(7).toLowerCase() : null,
      })),
    };
  }

  private release(name: ToolName): Promise<Release> {
    if (name === '7zip') return this.githubRelease('ip7z/7zip');
    if (name === 'yt-dlp') return this.githubRelease('yt-dlp/yt-dlp');
    return this.githubRelease('BtbN/FFmpeg-Builds');
  }

  private pick(release: Release, re: RegExp): Asset {
    const a = release.assets.find((x) => re.test(x.name));
    if (!a) throw new Error(`no download for this system in release ${release.version}`);
    return a;
  }

  /** Looks up an asset's SHA-256 in a checksum file from the same release ("<hash>  <name>" lines). */
  private async checksumFrom(release: Release, sumsName: RegExp, asset: Asset): Promise<string | null> {
    if (asset.sha256) return asset.sha256;
    const sums = release.assets.find((x) => sumsName.test(x.name));
    if (!sums) return null;
    const { res } = await openRequest(sums.url, { headers: { 'User-Agent': UA }, timeoutMs: 30_000 });
    const chunks: Buffer[] = [];
    for await (const c of res as AsyncIterable<Buffer>) chunks.push(c);
    for (const line of Buffer.concat(chunks).toString('utf8').split('\n')) {
      const m = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line);
      if (m && m[2] === asset.name) return m[1].toLowerCase();
    }
    return null;
  }

  /** Downloads an asset into `dir`, checking its SHA-256 when the release publishes one. */
  private async fetchAsset(name: ToolName, asset: Asset, dir: string, sha256: string | null): Promise<string> {
    const file = path.join(dir, asset.name);
    const { res } = await openRequest(asset.url, { headers: { 'User-Agent': UA }, timeoutMs: 60_000 });
    const live = this.live.get(name)!;
    const length = Number(res.headers['content-length']);
    live.size = Number.isFinite(length) ? length : asset.size || null;
    live.received = 0;
    const hash = createHash('sha256');
    const out = fs.createWriteStream(file);
    try {
      for await (const chunk of res as AsyncIterable<Buffer>) {
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()));
        live.received += chunk.length;
        this.emitTools();
      }
    } finally {
      await new Promise<void>((r) => out.end(r));
    }
    const actual = hash.digest('hex');
    if (sha256 && actual !== sha256) {
      fs.rmSync(file, { force: true });
      throw new Error(`${asset.name} failed its checksum (expected ${sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`);
    }
    return file;
  }

  /** Downloads and unpacks one tool into `work`; returns the program's path there. */
  private async setup(name: ToolName, release: Release, work: string): Promise<string> {
    const win = process.platform === 'win32';
    const mac = process.platform === 'darwin';
    if (name === 'yt-dlp') {
      const re = win ? (arm ? /^yt-dlp_arm64\.exe$/ : /^yt-dlp\.exe$/) : mac ? /^yt-dlp_macos$/ : arm ? /^yt-dlp_linux_aarch64$/ : /^yt-dlp_linux$/;
      const asset = this.pick(release, re);
      const file = await this.fetchAsset(name, asset, work, await this.checksumFrom(release, /^SHA2-256SUMS$/, asset));
      const bin = path.join(work, exe('yt-dlp'));
      fs.renameSync(file, bin);
      return bin;
    }
    if (name === '7zip') {
      if (win) {
        // 7zr.exe (7z format only) unpacks the full installer, which is itself a 7z archive with 7z.exe and 7z.dll (RAR too).
        const zr = this.pick(release, /^7zr\.exe$/);
        const sevenZr = await this.fetchAsset(name, zr, work, zr.sha256);
        const inst = this.pick(release, arm ? /^7z\d+-arm64\.exe$/ : /^7z\d+-x64\.exe$/);
        const installer = await this.fetchAsset(name, inst, work, inst.sha256);
        await run(sevenZr, ['x', '-y', `-o${path.join(work, 'app')}`, installer]);
        for (const f of [sevenZr, installer]) fs.rmSync(f, { force: true });
        return path.join(work, 'app', '7z.exe');
      }
      const asset = this.pick(release, mac ? /^7z\d+-mac\.tar\.xz$/ : arm ? /^7z\d+-linux-arm64\.tar\.xz$/ : /^7z\d+-linux-x64\.tar\.xz$/);
      const file = await this.fetchAsset(name, asset, work, asset.sha256);
      fs.mkdirSync(path.join(work, 'app'));
      await run('tar', ['-xJf', file, '-C', path.join(work, 'app')]);
      return path.join(work, 'app', '7zz');
    }
    // ffmpeg: BtbN's builds (Windows, Linux), unpacked with 7-Zip or tar. BtbN has no macOS build: there, a Homebrew copy is used.
    if (mac) throw new Error('install FFmpeg with Homebrew (brew install ffmpeg); Grabbit uses it from there');
    const asset = this.pick(release, win ? (arm ? /^ffmpeg-master-latest-winarm64-gpl\.zip$/ : /^ffmpeg-master-latest-win64-gpl\.zip$/) : arm ? /^ffmpeg-master-latest-linuxarm64-gpl\.tar\.xz$/ : /^ffmpeg-master-latest-linux64-gpl\.tar\.xz$/);
    const file = await this.fetchAsset(name, asset, work, await this.checksumFrom(release, /^checksums\.sha256$/, asset));
    const unpacked = path.join(work, 'unpacked');
    fs.mkdirSync(unpacked);
    if (win) await run(await this.ensure('7zip'), ['x', '-y', `-o${unpacked}`, file]);
    else await run('tar', ['-xJf', file, '-C', unpacked]);
    fs.rmSync(file, { force: true });
    const bin = findFile(unpacked, exe('ffmpeg'));
    if (!bin) throw new Error('the FFmpeg download has no ffmpeg program in it');
    return bin;
  }
}
