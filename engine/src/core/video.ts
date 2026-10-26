// Videos from web pages (YouTube, Vimeo and the ~1800 other sites yt-dlp knows): find the qualities a video comes in,
// then download one with yt-dlp, which fetches the video and audio tracks and has ffmpeg join them. Progress, pause
// (yt-dlp resumes its .part files) and errors map onto a normal download item.
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DownloadItem, Settings, VideoOption, VideoProbe } from '../../../shared/protocol';
import type { TaskHost } from './DownloadTask';
import { proxyUrlFor } from './proxy';
import { errorMessage, sanitizeFileName } from './util';

/** How to run yt-dlp: the program and any arguments that come first (tests run a script through node). */
export type Command = [string, ...string[]];

export interface VideoHost extends TaskHost {
  ytdlp(): Promise<Command>;
  /** ffmpeg's path, or null when it isn't available (then only single-file formats can be downloaded). */
  ffmpeg(): Promise<string | null>;
}

const HEIGHTS = [4320, 2160, 1440, 1080, 720, 480, 360, 240, 144];
const HEIGHT_LABEL: Record<number, string> = { 4320: '8K', 2160: '4K', 1440: '1440p', 1080: '1080p', 720: '720p', 480: '480p', 360: '360p', 240: '240p', 144: '144p' };

interface YtFormat {
  format_id: string;
  ext?: string;
  height?: number | null;
  vcodec?: string | null;
  acodec?: string | null;
  filesize?: number | null;
  filesize_approx?: number | null;
  tbr?: number | null;
}

interface YtInfo {
  title?: string;
  extractor_key?: string;
  webpage_url?: string;
  thumbnail?: string | null;
  duration?: number | null;
  formats?: YtFormat[];
  _type?: string;
}

const sizeOf = (f: YtFormat, duration: number | null) => f.filesize ?? f.filesize_approx ?? (f.tbr && duration ? Math.round((f.tbr * 1000 * duration) / 8) : null);
const hasVideo = (f: YtFormat) => !!f.vcodec && f.vcodec !== 'none';
const hasAudio = (f: YtFormat) => !!f.acodec && f.acodec !== 'none';

/** The choices offered for a video: best, each height it comes in, and audio only. Sizes are estimates. */
export function videoOptions(info: YtInfo): VideoOption[] {
  const formats = info.formats ?? [];
  const duration = info.duration ?? null;
  const audio = formats.filter((f) => hasAudio(f) && !hasVideo(f)).sort((a, b) => (sizeOf(b, duration) ?? 0) - (sizeOf(a, duration) ?? 0))[0];
  const audioSize = audio ? sizeOf(audio, duration) : null;
  const bestAt = (h: number | null) => {
    const fit = formats.filter((f) => hasVideo(f) && (h === null || (f.height ?? 0) <= h)).sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (sizeOf(b, duration) ?? 0) - (sizeOf(a, duration) ?? 0));
    const v = fit[0];
    if (!v) return null;
    const vs = sizeOf(v, duration);
    return { height: v.height ?? null, size: vs === null ? null : vs + (hasAudio(v) ? 0 : (audioSize ?? 0)) };
  };
  const out: VideoOption[] = [];
  const best = bestAt(null);
  if (best || formats.length === 0) {
    out.push({ format: 'bv*+ba/b', label: best?.height ? `Best quality (${HEIGHT_LABEL[best.height] ?? `${best.height}p`})` : 'Best quality', ext: 'mp4', height: best?.height ?? null, size: best?.size ?? null, audioOnly: false });
  }
  const heights = new Set(formats.filter(hasVideo).map((f) => f.height ?? 0));
  for (const h of HEIGHTS) {
    // Offer a height when the video has it (or something close below it), but not the best one twice.
    if (![...heights].some((x) => x <= h && x > h * 0.75) || h === best?.height) continue;
    const at = bestAt(h);
    out.push({ format: `bv*[height<=${h}]+ba/b[height<=${h}]`, label: HEIGHT_LABEL[h], ext: 'mp4', height: h, size: at?.size ?? null, audioOnly: false });
  }
  if (audio || formats.some(hasAudio)) {
    out.push({ format: 'ba[ext=m4a]/ba/b', label: 'Audio only', ext: audio?.ext === 'webm' ? 'webm' : 'm4a', height: null, size: audioSize, audioOnly: true });
  }
  return out;
}

function run(cmd: Command, args: string[], timeoutMs: number): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const [file, ...prefix] = cmd;
    const p = spawn(file, [...prefix, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.setEncoding('utf8').on('data', (d: string) => (out += d));
    p.stderr.setEncoding('utf8').on('data', (d: string) => {
      if (err.length < 20000) err += d;
    });
    const t = setTimeout(() => killTree(p), timeoutMs);
    p.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(t);
      resolve({ code: code ?? -1, out, err });
    });
  });
}

/** yt-dlp's last ERROR line, without the prefix, or a fallback. */
function ytError(err: string, fallback: string): string {
  const lines = err.split(/\r?\n/).filter((l) => /^ERROR:/.test(l));
  const last = lines[lines.length - 1]?.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?([\w-]+:\s*)?/, '').trim();
  return last || fallback;
}

/** The yt-dlp.exe that PyInstaller builds starts a child process; a plain kill would leave it running. */
function killTree(p: ChildProcess): void {
  if (p.exitCode !== null || p.pid === undefined) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => p.kill());
  else p.kill('SIGTERM');
}

async function proxyArgs(url: string): Promise<string[]> {
  try {
    // An empty --proxy means "connect directly", so a proxy in the environment doesn't apply when Grabbit says none.
    return ['--proxy', (await proxyUrlFor(new URL(url))) ?? ''];
  } catch {
    return [];
  }
}

export async function probeVideo(cmd: Command, url: string, settings: Settings): Promise<VideoProbe> {
  const args = ['-J', '--no-playlist', '--no-warnings', '--socket-timeout', String(settings.timeoutSec), ...(await proxyArgs(url)), '--', url];
  const r = await run(cmd, args, 90_000);
  if (r.code !== 0) throw new Error(ytError(r.err, 'No video found on this page'));
  let info: YtInfo;
  try {
    info = JSON.parse(r.out) as YtInfo;
  } catch {
    throw new Error('yt-dlp returned something unexpected');
  }
  if (info._type === 'playlist') throw new Error('That is a playlist: open one of its videos instead');
  const options = videoOptions(info);
  if (options.length === 0) throw new Error('No downloadable formats found on this page');
  return {
    url,
    title: info.title?.trim() || 'video',
    site: info.extractor_key ?? new URL(url).hostname,
    thumbnail: info.thumbnail ?? null,
    duration: info.duration ?? null,
    options,
  };
}

/** Without ffmpeg, separate video and audio tracks can't be joined: ask for single-file formats instead. */
export function withoutMerging(format: string): string {
  if (!format.includes('+')) return format;
  const h = /height<=(\d+)/.exec(format)?.[1];
  return h ? `b[height<=${h}]/b` : 'b';
}

/** One run of a video download (start until it completes, fails or is paused), like DownloadTask for files. */
export class VideoTask {
  private proc: ChildProcess | null = null;
  private runPromise: Promise<void> | null = null;
  private stopping = false;
  private activeSince = 0;

  constructor(readonly item: DownloadItem, private readonly host: VideoHost) {}

  get running(): boolean {
    return this.runPromise !== null;
  }

  /** The rate is applied when yt-dlp starts; a change takes effect on the next start. */
  setSpeedLimit(_rate: number): void {}

  start(): void {
    if (this.runPromise) return;
    this.runPromise = this.run()
      .catch((e) => {
        if (!this.stopping) this.set({ status: 'error', error: errorMessage(e) });
      })
      .finally(() => {
        this.item.activeMs += Date.now() - this.activeSince;
        this.runPromise = null;
        this.host.ended(this.item);
      });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.proc) killTree(this.proc);
    await this.runPromise;
  }

  private set(patch: Partial<DownloadItem>): void {
    Object.assign(this.item, patch);
    this.host.changed(this.item);
  }

  private async run(): Promise<void> {
    const item = this.item;
    const video = item.video!;
    const settings = this.host.settings();
    this.activeSince = Date.now();
    this.set({ status: 'connecting', error: null });
    const cmd = await this.host.ytdlp();
    const ffmpeg = await this.host.ffmpeg().catch(() => null);
    if (this.stopping) return;
    fs.mkdirSync(item.dir, { recursive: true });
    const base = sanitizeFileName(path.parse(item.fileName).name).replace(/%/g, '%%');
    const limit = item.speedLimit || (settings.speedLimitEnabled ? settings.speedLimit : 0);
    const args = [
      '-f', ffmpeg ? video.format : withoutMerging(video.format),
      '-S', 'res,ext:mp4:m4a',
      '--no-playlist', '--newline', '--progress', '--no-simulate', '--no-warnings', '--no-mtime',
      '--progress-template', 'download:GRABBIT-P %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s',
      '--print', 'after_move:GRABBIT-F %(filepath)s',
      '-P', item.dir,
      '-o', `${base}.%(ext)s`,
      '--retries', String(settings.maxRetries),
      '--socket-timeout', String(settings.timeoutSec),
      ...(ffmpeg ? ['--ffmpeg-location', ffmpeg] : []),
      ...(limit > 0 ? ['--limit-rate', String(limit)] : []),
      ...(item.referer ? ['--referer', item.referer] : []),
      ...(await proxyArgs(item.url)),
      '--', item.url,
    ];
    const [file, ...prefix] = cmd;
    const p = spawn(file, [...prefix, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = p;
    if (this.stopping) killTree(p);

    let done = 0; // bytes of the tracks already finished (video, then audio)
    let current = 0;
    let currentTotal = 0;
    let finalPath: string | null = null;
    let err = '';
    const onLine = (line: string) => {
      const m = /^GRABBIT-P (\S+) (\S+) (\S+)/.exec(line);
      if (m) {
        const got = Number(m[1]) || 0;
        const total = Number(m[2]) || Number(m[3]) || 0;
        if (got < current) done += currentTotal || current; // the next track started
        current = got;
        currentTotal = total;
        const received = done + current;
        const size = Math.max(item.size ?? 0, done + currentTotal, received);
        if (item.status !== 'downloading') this.set({ status: 'downloading' });
        item.received = received;
        item.size = size || null;
        return;
      }
      const f = /^GRABBIT-F (.+)$/.exec(line);
      if (f) finalPath = f[1].trim();
      else if (/^\[(Merger|ExtractAudio|FixupM3u8|VideoConvertor|VideoRemuxer)\]/.test(line) && item.status !== 'completing') this.set({ status: 'completing' });
    };
    let buf = '';
    p.stdout.setEncoding('utf8').on('data', (d: string) => {
      buf += d;
      let i;
      while ((i = buf.search(/\r?\n/)) >= 0) {
        onLine(buf.slice(0, i).replace(/\r$/, ''));
        buf = buf.slice(i + 1).replace(/^\n/, '');
      }
    });
    p.stderr.setEncoding('utf8').on('data', (d: string) => {
      if (err.length < 20000) err += d;
    });
    const code = await new Promise<number>((resolve, reject) => {
      p.on('error', reject);
      p.on('close', (c) => resolve(c ?? -1));
    });
    this.proc = null;
    if (this.stopping) return;
    if (code !== 0 || !finalPath) {
      this.set({ status: 'error', error: ytError(err, code === 0 ? 'yt-dlp finished without a file' : `yt-dlp stopped with code ${code}`) });
      return;
    }
    const size = fs.statSync(finalPath).size;
    this.set({ status: 'completed', completedAt: Date.now(), dir: path.dirname(finalPath), fileName: path.basename(finalPath), size, received: size, error: null });
  }
}
