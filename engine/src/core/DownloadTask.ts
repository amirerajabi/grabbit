import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DownloadItem, Segment, Settings } from '../../../shared/protocol';
import { categoryFor } from './categories';
import { AuthError, HttpError } from './http';
import { RateLimiter, sleep } from './limiter';
import { NoRangeError, sourceFor, type Source } from './sources';
import { errorMessage, TEMP_EXT, uniquePath } from './util';

/** A range is only split while both halves stay above this size (IDM-style dynamic segmentation). */
const MIN_SPLIT = 1024 * 1024;
/** Initial segments are never smaller than this. */
const MIN_INITIAL_SEGMENT = 512 * 1024;

export interface TaskHost {
  settings(): Settings;
  globalLimiter: RateLimiter;
  /** Status, size or name changed: broadcast and persist. */
  changed(item: DownloadItem): void;
  /** The run ended (completed, failed or stopped). */
  ended(item: DownloadItem): void;
  /** Final paths other downloads already claim, lower-cased. */
  claimedPaths(except: string): Set<string>;
  /** The server asked for a login that isn't saved, or refused the saved one. */
  loginRequired(item: DownloadItem, e: AuthError): void;
}

/**
 * One run of a download: from Start until it completes, fails or is paused. A paused task is discarded; the next
 * Start creates a new one that continues from the segments saved on the item.
 */
export class DownloadTask {
  private readonly abort = new AbortController();
  private readonly limiter = new RateLimiter();
  private fh: fs.promises.FileHandle | null = null;
  private runPromise: Promise<void> | null = null;
  private fatal: unknown = null;
  private activeSince = 0;
  private stopping = false;

  constructor(readonly item: DownloadItem, private readonly host: TaskHost) {
    this.limiter.setRate(item.speedLimit);
  }

  /** Built per use: the URL, headers and settings can change between runs (Properties, Options). */
  private source(): Source {
    return sourceFor(this.item, this.settings());
  }

  get running(): boolean {
    return this.runPromise !== null;
  }

  setSpeedLimit(rate: number): void {
    this.limiter.setRate(rate);
  }

  start(): void {
    if (this.runPromise) return;
    this.runPromise = this.run().finally(() => {
      this.runPromise = null;
      this.host.ended(this.item);
    });
  }

  /** Pause: abort every connection and wait until the file handle is closed. */
  async stop(): Promise<void> {
    this.stopping = true;
    this.abort.abort(new Error('Stopped'));
    await this.runPromise;
  }

  private get signal(): AbortSignal {
    return this.abort.signal;
  }

  private settings(): Settings {
    return this.host.settings();
  }

  private set(patch: Partial<DownloadItem>): void {
    Object.assign(this.item, patch);
    this.host.changed(this.item);
  }

  private tempPath(): string {
    return path.join(this.item.dir, this.item.fileName) + TEMP_EXT;
  }

  private async run(): Promise<void> {
    const item = this.item;
    this.activeSince = Date.now();
    this.set({ status: 'connecting', error: null, startedAt: item.startedAt ?? Date.now(), speed: 0, eta: null });
    try {
      let probed = false;
      if (item.finalUrl === null || (item.size === null && item.resumable)) {
        await this.probe();
        probed = true;
      }
      await fs.promises.mkdir(item.dir, { recursive: true });
      this.set({ status: 'downloading' });
      for (;;) {
        try {
          if (item.resumable && item.size !== null && item.size > 0) await this.runSegmented();
          else await this.runSingle();
          break;
        } catch (e) {
          if (this.signal.aborted) throw e;
          if (e instanceof NoRangeError) {
            // The server stopped honouring Range (or never did for this URL): start over with one connection.
            item.resumable = false;
            item.segments = [];
            continue;
          }
          // A redirect target that expired (signed CDN links): ask the original URL again, once.
          if (!probed && e instanceof HttpError && e.permanent) {
            probed = true;
            this.fatal = null;
            await this.probe();
            continue;
          }
          throw e;
        }
      }
      if (this.signal.aborted) throw this.signal.reason;
      await this.finish();
    } catch (e) {
      await this.closeFile();
      for (const s of item.segments) s.active = false;
      if (this.stopping || this.signal.aborted) {
        if (item.status !== 'completed') this.set({ status: 'stopped', speed: 0, eta: null });
      } else {
        this.set({ status: 'error', error: errorMessage(e), speed: 0, eta: null });
        if (e instanceof AuthError) this.host.loginRequired(item, e);
      }
    } finally {
      item.activeMs += Date.now() - this.activeSince;
    }
  }

  private async probe(): Promise<void> {
    const item = this.item;
    const info = await this.withRetries(() => this.source().probe(this.signal));
    const sameFile = item.size !== null && info.size === item.size && info.resumable;
    item.finalUrl = info.finalUrl;
    item.mime = info.mime ?? item.mime;
    if (!sameFile && item.segments.some((s) => s.received > 0)) {
      // The file changed on the server (or it never was resumable): the saved bytes are worthless.
      item.segments = [];
      item.received = 0;
      await fs.promises.rm(this.tempPath(), { force: true });
    }
    item.size = info.size;
    item.resumable = info.resumable;
    if (item.category === 'general' && item.received === 0) item.category = categoryFor(item.fileName, info.mime);
    this.host.changed(item);
  }

  private async openFile(truncateTo: number | null): Promise<fs.promises.FileHandle> {
    const p = this.tempPath();
    if (!fs.existsSync(p) || truncateTo === 0) await fs.promises.writeFile(p, '');
    const fh = await fs.promises.open(p, 'r+');
    if (truncateTo !== null && truncateTo > 0) {
      const st = await fh.stat();
      // Pre-allocate the whole file once, so every segment can write at its own offset.
      if (st.size !== truncateTo) await fh.truncate(truncateTo);
    }
    this.fh = fh;
    return fh;
  }

  private async closeFile(): Promise<void> {
    const fh = this.fh;
    this.fh = null;
    if (fh) await fh.close().catch(() => undefined);
  }

  // ------------------------------------------------------------------ segmented (resumable, known size)

  private initialSegments(size: number): Segment[] {
    const n = Math.max(1, Math.min(this.item.connections, Math.floor(size / MIN_INITIAL_SEGMENT)));
    const part = Math.floor(size / n);
    const segs: Segment[] = [];
    for (let i = 0; i < n; i++) {
      const start = i * part;
      const end = i === n - 1 ? size - 1 : start + part - 1;
      segs.push({ start, end, received: 0, active: false });
    }
    return segs;
  }

  private async runSegmented(): Promise<void> {
    const item = this.item;
    const size = item.size!;
    if (item.segments.length === 0 || item.segments.some((s) => s.end < 0)) item.segments = this.initialSegments(size);
    item.received = item.segments.reduce((a, s) => a + s.received, 0);
    await this.closeFile();
    const fh = await this.openFile(size);

    // Workers stop on a user pause (this.signal) or when one of them fails for good (ctl.abort(fatal)).
    const ctl = new AbortController();
    const onStop = () => ctl.abort(this.signal.reason);
    this.signal.addEventListener('abort', onStop, { once: true });
    const workers = new Set<Promise<void>>();
    const remaining = (s: Segment) => s.end - s.start + 1 - s.received;

    const spawn = (seg: Segment) => {
      seg.active = true;
      const w = this.segmentWorker(seg, fh, size, ctl.signal)
        .catch((e) => {
          if (!this.fatal && !ctl.signal.aborted) {
            this.fatal = e;
            ctl.abort(e);
          }
        })
        .finally(() => {
          seg.active = false;
          workers.delete(w);
          if (!ctl.signal.aborted) fill();
        });
      workers.add(w);
    };

    // Keep `connections` workers busy: idle ranges first, then split the largest range still being filled.
    const fill = () => {
      while (workers.size < item.connections && !ctl.signal.aborted) {
        const idle = item.segments.find((s) => !s.active && remaining(s) > 0);
        if (idle) {
          spawn(idle);
          continue;
        }
        const split = this.splitLargest();
        if (!split) break;
        spawn(split);
      }
    };

    fill();
    while (workers.size > 0) await Promise.race(workers);
    this.signal.removeEventListener('abort', onStop);
    if (this.fatal) {
      const e = this.fatal;
      this.fatal = null;
      throw e;
    }
    if (this.signal.aborted) throw this.signal.reason;
    item.segments = mergeDone(item.segments);
    if (item.segments.some((s) => remaining(s) > 0)) throw new Error('Download ended before all bytes arrived');
  }

  /** Halve the active range with the most bytes left; the new half starts its own connection. */
  private splitLargest(): Segment | null {
    let best: Segment | null = null;
    let bestLeft = 0;
    for (const s of this.item.segments) {
      const left = s.end - s.start + 1 - s.received;
      if (s.active && left > bestLeft) {
        best = s;
        bestLeft = left;
      }
    }
    if (!best || bestLeft < MIN_SPLIT * 2) return null;
    const cursor = best.start + best.received;
    const mid = cursor + Math.floor(bestLeft / 2);
    const seg: Segment = { start: mid, end: best.end, received: 0, active: false };
    best.end = mid - 1; // the running connection stops when it reaches its new end
    const segs = this.item.segments;
    segs.splice(segs.indexOf(best) + 1, 0, seg);
    return seg;
  }

  private async segmentWorker(seg: Segment, fh: fs.promises.FileHandle, size: number, signal: AbortSignal): Promise<void> {
    const item = this.item;
    let failures = 0;
    while (!signal.aborted) {
      const from = seg.start + seg.received;
      if (from > seg.end) return;
      const before = seg.received;
      try {
        const res = await this.source().openRange(from, seg.end, size, signal);
        for await (const chunk of res as AsyncIterable<Buffer>) {
          await this.throttle(chunk.length, signal);
          const left = seg.end - (seg.start + seg.received) + 1; // seg.end may shrink when the range is split
          if (left <= 0) break;
          const buf = chunk.length > left ? chunk.subarray(0, left) : chunk;
          await fh.write(buf, 0, buf.length, seg.start + seg.received);
          seg.received += buf.length;
          item.received += buf.length;
          if (buf.length < chunk.length || seg.received >= seg.end - seg.start + 1) break;
        }
        if (seg.start + seg.received > seg.end) return;
        throw new Error('The server closed the connection early');
      } catch (e) {
        if (signal.aborted) return;
        if (e instanceof NoRangeError) throw e;
        if (e instanceof HttpError && e.permanent) throw e;
        if (seg.received > before) failures = 0; // made progress: the connection is just flaky
        failures++;
        item.retries++;
        if (failures > this.settings().maxRetries) throw e;
        await sleep(this.settings().retryDelaySec * 1000, signal).catch(() => undefined);
      }
    }
  }

  // ------------------------------------------------------------------ single stream (no Range support or unknown size)

  private async runSingle(): Promise<void> {
    const item = this.item;
    let failures = 0;
    while (!this.signal.aborted) {
      // Without Range support every attempt starts at byte 0.
      item.segments = [{ start: 0, end: item.size !== null ? item.size - 1 : -1, received: 0, active: true }];
      item.received = 0;
      await this.closeFile();
      const fh = await this.openFile(0);
      const seg = item.segments[0];
      try {
        const { stream: res, length } = await this.source().openAll(this.signal);
        if (item.size === null && length !== null) {
          item.size = length;
          seg.end = length - 1;
          this.host.changed(item);
        }
        for await (const chunk of res as AsyncIterable<Buffer>) {
          await this.throttle(chunk.length);
          await fh.write(chunk, 0, chunk.length, seg.received);
          seg.received += chunk.length;
          item.received += chunk.length;
        }
        if (this.signal.aborted) return;
        if (item.size !== null && seg.received < item.size) throw new Error('The server closed the connection early');
        if (item.size === null) {
          item.size = seg.received;
          seg.end = seg.received - 1;
        }
        seg.active = false;
        return;
      } catch (e) {
        if (this.signal.aborted) return;
        if (e instanceof HttpError && e.permanent) throw e;
        failures++;
        item.retries++;
        if (failures > this.settings().maxRetries) throw e;
        await sleep(this.settings().retryDelaySec * 1000, this.signal).catch(() => undefined);
      }
    }
  }

  /** Retry transient failures (network errors, 5xx) with the configured delay; 4xx fails at once. */
  private async withRetries<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (this.signal.aborted || (e instanceof HttpError && e.permanent) || attempt >= this.settings().maxRetries) throw e;
        this.item.retries++;
        await sleep(this.settings().retryDelaySec * 1000, this.signal);
      }
    }
  }

  private async throttle(n: number, signal: AbortSignal = this.signal): Promise<void> {
    await this.limiter.take(n, signal);
    await this.host.globalLimiter.take(n, signal);
  }

  // ------------------------------------------------------------------ completion

  private async finish(): Promise<void> {
    const item = this.item;
    this.set({ status: 'completing', speed: 0, eta: 0 });
    await this.closeFile();
    let target = path.join(item.dir, item.fileName);
    if (fs.existsSync(target)) {
      if (this.settings().duplicateAction === 'overwrite') {
        await fs.promises.rm(target, { force: true });
      } else {
        target = uniquePath(item.dir, item.fileName, this.host.claimedPaths(item.id));
      }
    }
    await fs.promises.rename(this.tempPath(), target);
    item.fileName = path.basename(target);
    for (const s of item.segments) s.active = false;
    item.segments = mergeDone(item.segments);
    this.set({ status: 'completed', completedAt: Date.now(), received: item.size ?? item.received, error: null });
  }

  /** Transfer time including the current run, for the average speed. */
  activeMsNow(): number {
    return this.item.activeMs + (Date.now() - this.activeSince);
  }
}

/** Collapse finished neighbouring ranges so a completed or long-running item keeps a short segment list. */
function mergeDone(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of [...segs].sort((a, b) => a.start - b.start)) {
    const prev = out[out.length - 1];
    const done = s.received >= s.end - s.start + 1;
    if (prev && done && !prev.active && prev.received >= prev.end - prev.start + 1 && prev.end + 1 === s.start) {
      prev.end = s.end;
      prev.received += s.received;
    } else {
      out.push({ ...s });
    }
  }
  return out;
}
