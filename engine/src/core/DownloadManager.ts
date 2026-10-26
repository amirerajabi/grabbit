import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  AddDownloadRequest,
  BulkAction,
  CaptureRequest,
  DownloadItem,
  EngineEvent,
  GrabRequest,
  GrabResult,
  ProbeResult,
  ProgressEntry,
  Queue,
  QueueSchedule,
  Settings,
  ToolName,
  WhenDoneAction,
} from '../../../shared/protocol';
import { categoryFolder, categoryFor, extensionOf, isCategoryId } from './categories';
import { DownloadTask, type TaskHost } from './DownloadTask';
import { archiveName, extractArchive, extractDir } from './extract';
import { grabSite } from './grabber';
import { RateLimiter, SpeedMeter } from './limiter';
import { hashFile, isHashAlgo, parseChecksum, runPowerAction, scanFile } from './post';
import { parseProxyUrl, setProxySettings } from './proxy';
import { SecretStore } from './secrets';
import { AuthError, setCredentialLookup } from './http';
import { isSupportedUrl, probeAny, requestHeaders } from './sources';
import { setKnownHostsFile } from './sources/sftp';
import { openPath } from './shell';
import { defaultSettings, mergeSettings } from './settings';
import { ToolManager } from './tools';
import { atomicWrite, clamp, isHttpUrl, newId, readJson, sanitizeFileName, TEMP_EXT, uniquePath } from './util';

const MAIN_QUEUE = 'main';
const PROGRESS_MS = 500;
const SAVE_MS = 2000;
const RUNNING = new Set(['connecting', 'downloading', 'completing']);

interface StoreFile {
  version: 1;
  downloads: DownloadItem[];
  queues: Queue[];
}

export class DownloadManager extends EventEmitter implements TaskHost {
  private items = new Map<string, DownloadItem>();
  private tasks = new Map<string, DownloadTask>();
  private meters = new Map<string, SpeedMeter>();
  private queues: Queue[] = [];
  private settingsValue: Settings = defaultSettings();
  readonly globalLimiter = new RateLimiter();
  /** The settings file write in flight (writes are chained). */
  private settingsWrite: Promise<void> = Promise.resolve();
  /** Set by the server: is a window listening for capture prompts? */
  uiConnected: () => boolean = () => false;
  private dirty = false;
  private saveTimer: NodeJS.Timeout | null = null;
  private progressTimer: NodeJS.Timeout | null = null;
  private scheduleTimer: NodeJS.Timeout | null = null;
  /** Downloads that stopped for a login prompt (their failure needs no toast). */
  private askedLogin = new Set<string>();
  /** Downloads whose post-processing (verify, scan, extract) is still running. */
  private posting = new Set<string>();
  /** The pending when-done action: timer and the time it fires. */
  private whenDoneTimer: { timer: NodeJS.Timeout; at: number } | null = null;
  /** Site grabber crawls in progress, by the caller's id, so they can be stopped. */
  private grabs = new Map<string, AbortController>();
  /** "queueId@yyyy-mm-dd HH:mm:start|stop" of the last schedule action, so a minute fires once. */
  private fired = new Set<string>();

  /** Saved site logins and archive passwords, encrypted on disk. */
  readonly secrets: SecretStore;
  /** 7-Zip, yt-dlp and ffmpeg, fetched on first use. */
  readonly tools: ToolManager;

  constructor(private readonly dataDir: string) {
    super();
    this.secrets = new SecretStore(dataDir);
    this.tools = new ToolManager(dataDir);
    this.tools.on('tools', (tools) => this.emitEvent({ type: 'tools', tools }));
  }

  // ------------------------------------------------------------------ lifecycle

  load(): void {
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.secrets.load();
    setCredentialLookup((host) => this.secrets.lookup(host));
    setKnownHostsFile(this.file('known_hosts.json'));
    const saved = readJson<Partial<Settings>>(this.file('settings.json'));
    this.settingsValue = mergeSettings(defaultSettings(), saved ?? {});
    this.applyLimits();
    const store = readJson<StoreFile>(this.file('downloads.json'));
    this.queues = store?.queues?.length ? store.queues.map((q) => ({ ...q, running: false })) : [];
    if (!this.queues.some((q) => q.id === MAIN_QUEUE)) {
      this.queues.unshift({ id: MAIN_QUEUE, name: 'Main queue', maxConcurrent: 3, running: false, builtIn: true, schedule: emptySchedule() });
    }
    for (const d of store?.downloads ?? []) {
      // Whatever was running when the engine stopped is paused now; its segments are on disk.
      if (RUNNING.has(d.status)) d.status = 'stopped';
      for (const s of d.segments) s.active = false;
      d.speed = 0;
      d.eta = null;
      // Fields added after 1.0.2: older lists don't have them.
      d.checksum ??= null;
      d.post ??= emptyPost();
      if (d.post.step) d.post.step = null;
      d.openWhenDone ??= false;
      d.extract ??= null;
      this.items.set(d.id, d);
    }
    // unref: the HTTP server is what keeps the engine alive, not these timers.
    this.progressTimer = setInterval(() => this.tick(), PROGRESS_MS).unref();
    this.scheduleTimer = setInterval(() => this.checkSchedules(), 15_000).unref();
  }

  async shutdown(): Promise<void> {
    if (this.progressTimer) clearInterval(this.progressTimer);
    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
    if (this.whenDoneTimer) clearTimeout(this.whenDoneTimer.timer);
    await Promise.all([...this.tasks.values()].map((t) => t.stop()));
    await this.saveNow();
    await this.settingsWrite;
    await this.secrets.flush();
  }

  private file(name: string): string {
    return path.join(this.dataDir, name);
  }

  private emitEvent(e: EngineEvent): void {
    this.emit('event', e);
  }

  // ------------------------------------------------------------------ persistence

  private markDirty(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.saveNow();
    }, SAVE_MS);
  }

  async saveNow(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.dirty) return;
    this.dirty = false;
    const store: StoreFile = { version: 1, downloads: [...this.items.values()], queues: this.queues };
    try {
      await atomicWrite(this.file('downloads.json'), JSON.stringify(store));
    } catch (e) {
      this.dirty = true;
      console.error('save failed', e);
    }
  }

  // ------------------------------------------------------------------ TaskHost

  settings(): Settings {
    return this.settingsValue;
  }

  changed(item: DownloadItem): void {
    this.markDirty();
    this.emitEvent({ type: 'download.updated', item: snapshot(item) });
  }

  ended(item: DownloadItem): void {
    this.tasks.delete(item.id);
    this.meters.delete(item.id);
    item.speed = 0;
    item.eta = null;
    this.changed(item);
    if (item.status === 'completed') {
      this.posting.add(item.id);
      void this.postProcess(item).finally(() => {
        this.posting.delete(item.id);
        this.checkWhenDone();
      });
    } else if (item.status === 'error' && !this.askedLogin.delete(item.id)) {
      // (A login prompt already explains it; no failure toast on top.)
      this.emitEvent({ type: 'notify', level: 'error', text: `Download failed: ${item.fileName}`, detail: item.error ?? undefined, downloadId: item.id });
    }
    this.pump();
    this.checkWhenDone();
  }

  // ------------------------------------------------------------------ after the download

  /**
   * Verify, scan, extract, then announce (and open) the file. A failed step is recorded on the item and stops the
   * steps after it that would use a bad file; it never throws.
   */
  private async postProcess(item: DownloadItem): Promise<void> {
    const file = path.join(item.dir, item.fileName);
    const post = (patch: Partial<DownloadItem['post']>) => {
      item.post = { ...item.post, ...patch };
      this.changed(item);
    };
    let ok = true;
    try {
      if (item.checksum?.expected) {
        post({ step: 'verifying' });
        ok = await this.verify(item, file);
      }
      if (ok && this.settingsValue.scanAfterDownload) {
        post({ step: 'scanning' });
        const r = await scanFile(file, this.settingsValue.scanCommand);
        post({ scan: r.result, message: r.message });
        if (r.result === 'threat') {
          ok = false;
          this.emitEvent({ type: 'notify', level: 'error', text: `Threat found in ${item.fileName}`, detail: r.message ?? undefined, downloadId: item.id });
        }
      }
      if (ok && archiveName(item.fileName) && (item.extract ?? this.settingsValue.extractArchives)) {
        await this.extract(item);
      }
    } catch (e) {
      post({ message: e instanceof Error ? e.message : String(e) });
    } finally {
      post({ step: null });
    }
    if (!ok) return;
    this.emitEvent({ type: 'notify', level: 'success', text: 'Download complete', detail: item.fileName, downloadId: item.id });
    if (item.openWhenDone) {
      try {
        openPath(item.post.extractedTo ?? file, false);
      } catch {
        /* the file was moved or deleted meanwhile */
      }
    }
  }

  /**
   * Extracts a finished archive. For a multi-part set it waits until every part in the list has finished, then runs
   * once (from whichever part finished last) and records the result on all of them. `password` is tried first.
   */
  private async extract(item: DownloadItem, password?: string): Promise<void> {
    const name = archiveName(item.fileName);
    if (!name) throw new Error('This file is not an archive Grabbit can extract (ZIP, 7z or RAR)');
    const sameSet = [...this.items.values()].filter((d) => d.dir === item.dir && archiveName(d.fileName)?.group === name.group);
    if (sameSet.some((d) => d.status !== 'completed')) return;
    const first = sameSet.find((d) => archiveName(d.fileName)!.first);
    if (!first) {
      this.setPost(sameSet, { extract: 'failed', message: 'The first part of the archive is not in the download list' });
      return;
    }
    const archive = path.join(first.dir, first.fileName);
    this.setPost(sameSet, { step: 'extracting', message: null });
    try {
      const bin = await this.tools.ensure('7zip');
      const dest = extractDir(item.dir, name.base);
      const passwords = [...(password ? [password] : []), ...this.secrets.archivePasswords()];
      let lastPct = -1;
      const r = await extractArchive(bin, archive, dest, passwords, (pct) => {
        if (pct === lastPct) return;
        lastPct = pct;
        this.setPost(sameSet, { message: `Extracting ${pct}%` });
      });
      this.setPost(sameSet, { extract: r.result, extractedTo: r.result === 'done' ? dest : null, message: r.message });
      if (r.result === 'done' && password && !this.secrets.archivePasswords().includes(password)) this.secrets.addArchivePassword(password);
      if (r.result === 'done' && this.settingsValue.deleteArchiveAfterExtract) {
        for (const d of sameSet) fs.rmSync(path.join(d.dir, d.fileName), { force: true });
      }
      if (r.result !== 'done') {
        this.emitEvent({
          type: 'notify',
          level: r.result === 'password' ? 'info' : 'error',
          text: r.result === 'password' ? `${item.fileName} needs a password to extract` : `Couldn't extract ${item.fileName}`,
          detail: r.message ?? undefined,
          downloadId: item.id,
        });
      }
    } catch (e) {
      this.setPost(sameSet, { extract: 'failed', message: e instanceof Error ? e.message : String(e) });
    } finally {
      this.setPost(sameSet.filter((d) => d !== item), { step: null });
    }
  }

  private setPost(items: DownloadItem[], patch: Partial<DownloadItem['post']>): void {
    for (const d of items) {
      d.post = { ...d.post, ...patch };
      this.changed(d);
    }
  }

  /** Extract on request (the details pane), with a password the user typed if there is one. */
  async extractNow(id: string, password?: string): Promise<DownloadItem> {
    const item = this.items.get(id);
    if (!item) throw new Error('No such download');
    if (item.status !== 'completed') throw new Error('The download is not finished yet');
    if (this.posting.has(id)) throw new Error('Already working on this file');
    this.posting.add(id);
    try {
      await this.extract(item, password?.trim() || undefined);
    } finally {
      item.post = { ...item.post, step: null };
      this.changed(item);
      this.posting.delete(id);
    }
    return snapshot(item);
  }

  /** Fetch a helper program now (Options → Tools), instead of on first use. */
  async installTool(name: ToolName): Promise<void> {
    await this.tools.ensure(name);
  }

  /** Checks the finished file against the expected hash; true when it matches. */
  private async verify(item: DownloadItem, file: string): Promise<boolean> {
    const c = item.checksum!;
    c.state = 'computing';
    this.changed(item);
    try {
      c.actual = await hashFile(file, c.algo);
      c.state = c.actual === c.expected ? 'ok' : 'mismatch';
    } catch (e) {
      c.state = 'failed';
      item.post.message = e instanceof Error ? e.message : String(e);
    }
    this.changed(item);
    if (c.state === 'mismatch') {
      this.emitEvent({ type: 'notify', level: 'error', text: `Checksum mismatch: ${item.fileName}`, detail: 'The file is damaged or not the one expected. Redownload it.', downloadId: item.id });
    }
    return c.state === 'ok';
  }

  /** Compute (and, with an expected value, check) a finished file's hash on request. */
  async computeChecksum(id: string, algo: unknown, expected?: string): Promise<DownloadItem> {
    const item = this.items.get(id);
    if (!item) throw new Error('No such download');
    if (item.status !== 'completed') throw new Error('The download is not finished yet');
    const parsed = expected ? parseChecksum(expected) : null;
    if (expected && !parsed) throw new Error('That is not an MD5, SHA-1, SHA-256 or SHA-512 hash');
    const a = parsed?.algo ?? (isHashAlgo(algo) ? algo : 'sha256');
    item.checksum = { algo: a, expected: parsed?.expected ?? null, actual: null, state: 'computing' };
    this.changed(item);
    const file = path.join(item.dir, item.fileName);
    if (item.checksum.expected) {
      await this.verify(item, file);
      return item;
    }
    try {
      item.checksum.actual = await hashFile(file, a);
      item.checksum.state = 'computed';
    } catch (e) {
      item.checksum.state = 'failed';
      throw e;
    } finally {
      this.changed(item);
    }
    return item;
  }

  // ------------------------------------------------------------------ when everything is done

  /** Nothing running, queued to run, or still being post-processed. */
  private allDone(): boolean {
    if (this.tasks.size > 0 || this.posting.size > 0) return false;
    return !this.queues.some((q) => q.running && [...this.items.values()].some((d) => d.queueId === q.id && d.status === 'queued'));
  }

  /** Start the countdown for the when-done action once everything has finished; a new download cancels it. */
  private checkWhenDone(): void {
    const action = this.settingsValue.whenDone;
    if (action === 'nothing') return;
    if (!this.allDone()) {
      if (this.whenDoneTimer) this.cancelWhenDone(false);
      return;
    }
    if (this.whenDoneTimer) return;
    const delay = Number(process.env.GRABBIT_WHEN_DONE_DELAY_MS) || 60_000;
    const at = Date.now() + delay;
    this.whenDoneTimer = { at, timer: setTimeout(() => void this.fireWhenDone(action), delay) };
    this.emitEvent({ type: 'whenDone', action, at });
  }

  /** Cancel a pending countdown; `reset` also turns the action off (the user's Cancel). */
  cancelWhenDone(reset = true): void {
    if (this.whenDoneTimer) {
      clearTimeout(this.whenDoneTimer.timer);
      this.whenDoneTimer = null;
      this.emitEvent({ type: 'whenDone', action: this.settingsValue.whenDone, at: null });
    }
    if (reset && this.settingsValue.whenDone !== 'nothing') this.updateSettings({ whenDone: 'nothing' });
  }

  /** The pending countdown, for a window that connects while it runs. */
  whenDoneState(): { action: WhenDoneAction; at: number } | null {
    return this.whenDoneTimer ? { action: this.settingsValue.whenDone, at: this.whenDoneTimer.at } : null;
  }

  private async fireWhenDone(action: WhenDoneAction): Promise<void> {
    this.whenDoneTimer = null;
    if (!this.allDone() || this.settingsValue.whenDone !== action) return;
    // One-shot, like IDM: the next batch of downloads doesn't turn the computer off again.
    this.updateSettings({ whenDone: 'nothing' });
    await this.saveNow();
    if (action === 'quit') {
      this.emitEvent({ type: 'quit' });
      return;
    }
    try {
      const done = await runPowerAction(action);
      this.emitEvent({ type: 'notify', level: 'info', text: `When done: ${action}`, detail: done });
    } catch (e) {
      this.emitEvent({ type: 'notify', level: 'error', text: `Could not ${action === 'shutdown' ? 'shut down' : action}`, detail: e instanceof Error ? e.message : String(e) });
    }
  }

  /** A server wants a login: the window asks for it, then resumes the download. */
  loginRequired(item: DownloadItem, e: AuthError): void {
    this.askedLogin.add(item.id);
    this.emitEvent({ type: 'login.required', downloadId: item.id, site: e.site, realm: e.realm, failed: e.failed });
  }

  claimedPaths(except: string): Set<string> {
    const s = new Set<string>();
    for (const d of this.items.values()) if (d.id !== except && d.status !== 'completed') s.add(path.join(d.dir, d.fileName).toLowerCase());
    return s;
  }

  // ------------------------------------------------------------------ queries

  state() {
    return {
      downloads: [...this.items.values()].map(snapshot),
      queues: this.queues,
      settings: this.settingsValue,
    };
  }

  get(id: string): DownloadItem | undefined {
    return this.items.get(id);
  }

  getSettings(): Settings {
    return this.settingsValue;
  }

  dirFor(category: DownloadItem['category']): string {
    const s = this.settingsValue;
    const sub = s.useCategoryFolders ? categoryFolder(category) : '';
    return sub ? path.join(s.downloadDir, sub) : s.downloadDir;
  }

  /** Site grabber: crawl from a page and return the links to files of the chosen types. */
  async grab(raw: Partial<GrabRequest>): Promise<GrabResult> {
    const url = String(raw.url ?? '').trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('Enter the address of a web page (http or https)');
    const req: GrabRequest = {
      id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : newId(),
      url,
      depth: clamp(Math.round(Number(raw.depth) || 0), 0, 3),
      sameSite: raw.sameSite !== false,
      extensions: Array.isArray(raw.extensions) ? raw.extensions.filter((x): x is string => typeof x === 'string').slice(0, 200) : this.settingsValue.captureExtensions,
    };
    if (req.extensions.length === 0) throw new Error('Choose at least one file type');
    this.grabs.get(req.id)?.abort();
    const ac = new AbortController();
    this.grabs.set(req.id, ac);
    let last = 0;
    try {
      return await grabSite(req, requestHeaders({ headers: {}, referer: null }, this.settingsValue), this.settingsValue.timeoutSec * 1000, ac.signal, (pages, files) => {
        const now = Date.now();
        if (now - last < 250) return;
        last = now;
        this.emitEvent({ type: 'grab', id: req.id, pages, files });
      });
    } finally {
      if (this.grabs.get(req.id) === ac) this.grabs.delete(req.id);
    }
  }

  /** Stops a crawl; it returns what it found so far. */
  stopGrab(id: string): void {
    this.grabs.get(id)?.abort();
  }

  async probe(url: string, headers: Record<string, string> = {}, referer?: string): Promise<ProbeResult> {
    if (!isSupportedUrl(url)) throw new Error('Enter an http, https, ftp or sftp address');
    const info = await probeAny(url, this.settingsValue, { headers, referer });
    return { url, ...info, dir: this.dirFor(info.category) };
  }

  // ------------------------------------------------------------------ commands

  add(req: AddDownloadRequest): DownloadItem {
    const url = (req.url ?? '').trim();
    if (!isSupportedUrl(url)) throw new Error('Enter an http, https, ftp or sftp address');
    let fileName = sanitizeFileName(req.fileName?.trim() || fileNameFromUrl(url));
    const category = isCategoryId(req.category) ? req.category : categoryFor(fileName, req.probe?.mime);
    const dir = req.dir?.trim() || this.dirFor(category);
    if (this.settingsValue.duplicateAction === 'rename') fileName = path.basename(uniquePath(dir, fileName, this.claimedPaths('')));
    const queueId = req.start === 'queue' ? (this.queues.some((q) => q.id === req.queueId) ? req.queueId! : MAIN_QUEUE) : null;
    const item: DownloadItem = {
      id: newId(),
      url,
      finalUrl: req.probe?.finalUrl ?? null,
      fileName,
      dir,
      category,
      size: req.probe?.size ?? null,
      received: 0,
      status: req.start === 'queue' ? 'queued' : 'stopped',
      error: null,
      resumable: req.probe?.resumable ?? false,
      connections: clamp(Math.round(req.connections ?? this.settingsValue.maxConnections), 1, 32),
      segments: [],
      speed: 0,
      eta: null,
      mime: req.probe?.mime ?? null,
      referer: req.referer?.trim() || null,
      headers: sanitizeHeaders(req.headers),
      description: req.description?.trim() ?? '',
      queueId,
      queueOrder: this.nextOrder(queueId),
      speedLimit: 0,
      addedAt: Date.now(),
      startedAt: null,
      completedAt: null,
      activeMs: 0,
      retries: 0,
      checksum: null,
      post: emptyPost(),
      openWhenDone: req.openWhenDone === true,
      extract: typeof req.extract === 'boolean' ? req.extract : null,
    };
    if (req.checksum?.trim()) {
      item.checksum = parseChecksum(req.checksum);
      if (!item.checksum) throw new Error('That is not an MD5, SHA-1, SHA-256 or SHA-512 hash');
    }
    this.items.set(item.id, item);
    this.markDirty();
    this.emitEvent({ type: 'download.added', item: snapshot(item) });
    if (req.start === 'now') this.startOne(item);
    else this.pump();
    return item;
  }

  addBatch(urls: string[], base: Omit<AddDownloadRequest, 'url'>): DownloadItem[] {
    const out: DownloadItem[] = [];
    for (const url of urls) {
      if (!isSupportedUrl(url.trim())) continue;
      out.push(this.add({ ...base, url: url.trim(), fileName: undefined, probe: undefined, start: base.start === 'now' ? 'queue' : base.start }));
    }
    // "Start now" for a batch means: put them in the queue and run it, so they respect its concurrency.
    if (base.start === 'now') this.startQueue(base.queueId && this.queues.some((q) => q.id === base.queueId) ? base.queueId : MAIN_QUEUE);
    return out;
  }

  private nextOrder(queueId: string | null): number {
    let max = 0;
    for (const d of this.items.values()) if (d.queueId === queueId) max = Math.max(max, d.queueOrder);
    return max + 1;
  }

  private startOne(item: DownloadItem): void {
    if (this.tasks.has(item.id) || item.status === 'completed') return;
    const task = new DownloadTask(item, this);
    this.tasks.set(item.id, task);
    if (this.whenDoneTimer) this.cancelWhenDone(false);
    const meter = new SpeedMeter();
    meter.reset(item.received);
    this.meters.set(item.id, meter);
    task.start();
  }

  async pause(item: DownloadItem, requeue = false): Promise<void> {
    const task = this.tasks.get(item.id);
    if (task) await task.stop();
    if (item.status !== 'completed' && item.status !== 'error') {
      item.status = requeue && item.queueId ? 'queued' : 'stopped';
      this.changed(item);
    }
  }

  async bulk(ids: string[], action: BulkAction, arg?: string): Promise<void> {
    const items = ids.map((id) => this.items.get(id)).filter((d): d is DownloadItem => !!d);
    switch (action) {
      case 'start':
        for (const d of items) if (d.status !== 'completed') this.startOne(d);
        break;
      case 'pause':
        await Promise.all(items.map((d) => this.pause(d)));
        break;
      case 'redownload':
        for (const d of items) await this.redownload(d);
        break;
      case 'remove':
      case 'delete':
        await this.remove(items, action === 'delete');
        break;
      case 'moveToQueue': {
        const q = arg ? this.queues.find((x) => x.id === arg) : null;
        for (const d of items) {
          if (d.status === 'completed') continue;
          d.queueId = q ? q.id : null;
          d.queueOrder = this.nextOrder(d.queueId);
          if (q && (d.status === 'stopped' || d.status === 'error')) d.status = 'queued';
          if (!q && d.status === 'queued') d.status = 'stopped';
          this.changed(d);
        }
        this.pump();
        break;
      }
      case 'moveUp':
      case 'moveDown':
        for (const d of items) this.reorder(d, action === 'moveUp' ? -1 : 1);
        break;
    }
  }

  private reorder(item: DownloadItem, dir: -1 | 1): void {
    const peers = [...this.items.values()].filter((d) => d.queueId === item.queueId && d.queueId !== null).sort((a, b) => a.queueOrder - b.queueOrder);
    const i = peers.indexOf(item);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= peers.length) return;
    const other = peers[j];
    [item.queueOrder, other.queueOrder] = [other.queueOrder, item.queueOrder];
    this.changed(item);
    this.changed(other);
  }

  private async redownload(item: DownloadItem): Promise<void> {
    await this.pause(item);
    await fs.promises.rm(path.join(item.dir, item.fileName) + TEMP_EXT, { force: true });
    Object.assign(item, { segments: [], received: 0, finalUrl: null, size: null, status: 'stopped', error: null, completedAt: null, activeMs: 0, retries: 0, post: emptyPost() });
    if (item.checksum) item.checksum = { ...item.checksum, actual: null, state: 'pending' };
    if (this.settingsValue.duplicateAction === 'rename') item.fileName = path.basename(uniquePath(item.dir, item.fileName, this.claimedPaths(item.id)));
    this.changed(item);
    this.startOne(item);
  }

  private async remove(items: DownloadItem[], deleteFiles: boolean): Promise<void> {
    for (const d of items) {
      const task = this.tasks.get(d.id);
      if (task) await task.stop();
      const full = path.join(d.dir, d.fileName);
      // An unfinished download's partial file is useless without its entry, so it always goes.
      await fs.promises.rm(full + TEMP_EXT, { force: true }).catch(() => undefined);
      if (deleteFiles && d.status === 'completed') await fs.promises.rm(full, { force: true }).catch(() => undefined);
      this.items.delete(d.id);
    }
    this.markDirty();
    this.emitEvent({ type: 'download.removed', ids: items.map((d) => d.id) });
    this.pump();
  }

  async update(
    id: string,
    patch: Partial<Pick<DownloadItem, 'url' | 'fileName' | 'connections' | 'speedLimit' | 'description' | 'referer' | 'openWhenDone' | 'extract'>> & { checksum?: string | null },
  ): Promise<DownloadItem> {
    const item = this.items.get(id);
    if (!item) throw new Error('No such download');
    if (patch.url !== undefined) {
      const url = patch.url.trim();
      if (!isSupportedUrl(url)) throw new Error('Enter an http, https, ftp or sftp address');
      if (url !== item.url) {
        // "Refresh download address" (expired link): keep the bytes, ask the new address on the next start.
        item.url = url;
        item.finalUrl = null;
      }
    }
    if (patch.fileName !== undefined && item.status !== 'completed' && !this.tasks.has(id)) {
      const name = sanitizeFileName(patch.fileName);
      if (name !== item.fileName) {
        const oldTemp = path.join(item.dir, item.fileName) + TEMP_EXT;
        if (fs.existsSync(oldTemp)) await fs.promises.rename(oldTemp, path.join(item.dir, name) + TEMP_EXT);
        item.fileName = name;
      }
    }
    if (typeof patch.connections === 'number') item.connections = clamp(Math.round(patch.connections), 1, 32);
    if (typeof patch.speedLimit === 'number') {
      item.speedLimit = Math.max(0, Math.round(patch.speedLimit));
      this.tasks.get(id)?.setSpeedLimit(item.speedLimit);
    }
    if (typeof patch.description === 'string') item.description = patch.description;
    if (patch.referer !== undefined) item.referer = patch.referer?.trim() || null;
    if (typeof patch.openWhenDone === 'boolean') item.openWhenDone = patch.openWhenDone;
    if (patch.extract === null || typeof patch.extract === 'boolean') item.extract = patch.extract;
    if (patch.checksum !== undefined) {
      if (!patch.checksum?.trim()) {
        item.checksum = null;
      } else {
        const c = parseChecksum(patch.checksum);
        if (!c) throw new Error('That is not an MD5, SHA-1, SHA-256 or SHA-512 hash');
        item.checksum = c;
        // Already finished: check it now.
        if (item.status === 'completed') void this.verify(item, path.join(item.dir, item.fileName));
      }
    }
    this.changed(item);
    return item;
  }

  async pauseAll(): Promise<void> {
    for (const q of this.queues) q.running = false;
    this.emitEvent({ type: 'queues', queues: this.queues });
    await Promise.all([...this.tasks.values()].map((t) => this.pause(t.item)));
  }

  /** IDM's "Delete completed": forget finished entries (files stay on disk). */
  async removeCompleted(): Promise<void> {
    await this.remove([...this.items.values()].filter((d) => d.status === 'completed'), false);
  }

  updateSettings(patch: Partial<Settings>): Settings {
    if (patch.proxyMode === 'manual' || (patch.proxyUrl !== undefined && (patch.proxyMode ?? this.settingsValue.proxyMode) === 'manual')) {
      const url = patch.proxyUrl ?? this.settingsValue.proxyUrl;
      if (!parseProxyUrl(url)) throw new Error('Enter a proxy like http://host:8080 or socks5://host:1080');
    }
    this.settingsValue = mergeSettings(this.settingsValue, patch);
    this.applyLimits();
    // One write at a time, in order, so the file always ends with the latest settings; a failed write is logged, never
    // an unhandled rejection (which would take the engine down).
    const data = JSON.stringify(this.settingsValue, null, 2);
    this.settingsWrite = this.settingsWrite
      .then(() => atomicWrite(this.file('settings.json'), data))
      .catch((e) => console.error('saving settings failed', e));
    this.emitEvent({ type: 'settings', settings: this.settingsValue });
    return this.settingsValue;
  }

  private applyLimits(): void {
    const s = this.settingsValue;
    this.globalLimiter.setRate(s.speedLimitEnabled ? s.speedLimit : 0);
    setProxySettings({ mode: s.proxyMode, url: s.proxyUrl, bypass: s.proxyBypass });
  }

  /** "Download all links" from the extension: the window lets the user pick; with no window they wait in the main queue. */
  captureLinks(urls: string[], referer?: string, headers?: Record<string, string>): CaptureRequest | DownloadItem[] {
    const valid = [...new Set(urls.map((u) => u.trim()).filter(isHttpUrl))];
    if (valid.length === 0) throw new Error('No http(s) links');
    if (!this.uiConnected()) {
      // Nobody can pick from the list: keep the links to file types Grabbit captures, not the page's navigation.
      const exts = this.settingsValue.captureExtensions;
      const files = valid.filter((u) => exts.includes(extensionOf(fileNameFromUrl(u))));
      return this.addBatch(files, { start: 'none', referer, headers });
    }
    const request: CaptureRequest = { id: newId(), url: valid[0], urls: valid, referer, headers, source: 'browser' };
    this.emitEvent({ type: 'capture', request });
    return request;
  }

  capture(req: Omit<CaptureRequest, 'id'>): CaptureRequest | DownloadItem {
    if (!isHttpUrl(req.url)) throw new Error('Not an http(s) address');
    if (!this.settingsValue.showAddDialog || !this.uiConnected()) {
      return this.add({ url: req.url, fileName: req.fileName, referer: req.referer, headers: req.headers, start: 'now' });
    }
    const request: CaptureRequest = { ...req, id: newId() };
    this.emitEvent({ type: 'capture', request });
    return request;
  }

  // ------------------------------------------------------------------ queues

  createQueue(name: string): Queue {
    const q: Queue = { id: newId(), name: name.trim() || 'Queue', maxConcurrent: 1, running: false, builtIn: false, schedule: emptySchedule() };
    this.queues.push(q);
    this.queuesChanged();
    return q;
  }

  updateQueue(id: string, patch: Partial<Pick<Queue, 'name' | 'maxConcurrent'>> & { schedule?: Partial<QueueSchedule> }): Queue {
    const q = this.queues.find((x) => x.id === id);
    if (!q) throw new Error('No such queue');
    if (typeof patch.name === 'string' && patch.name.trim()) q.name = patch.name.trim();
    if (typeof patch.maxConcurrent === 'number') q.maxConcurrent = clamp(Math.round(patch.maxConcurrent), 1, 20);
    if (patch.schedule) {
      const s = patch.schedule;
      if (typeof s.enabled === 'boolean') q.schedule.enabled = s.enabled;
      if (s.startTime === null || (typeof s.startTime === 'string' && /^\d{2}:\d{2}$/.test(s.startTime))) q.schedule.startTime = s.startTime;
      if (s.stopTime === null || (typeof s.stopTime === 'string' && /^\d{2}:\d{2}$/.test(s.stopTime))) q.schedule.stopTime = s.stopTime;
      if (Array.isArray(s.days)) q.schedule.days = [...new Set(s.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    }
    this.queuesChanged();
    this.pump();
    return q;
  }

  async deleteQueue(id: string): Promise<void> {
    const q = this.queues.find((x) => x.id === id);
    if (!q || q.builtIn) throw new Error('This queue cannot be deleted');
    this.queues = this.queues.filter((x) => x.id !== id);
    for (const d of this.items.values()) {
      if (d.queueId !== id) continue;
      d.queueId = MAIN_QUEUE;
      d.queueOrder = this.nextOrder(MAIN_QUEUE);
      this.changed(d);
    }
    this.queuesChanged();
  }

  startQueue(id: string): void {
    const q = this.queues.find((x) => x.id === id);
    if (!q) throw new Error('No such queue');
    // Starting a queue picks up its stopped and failed items too, like IDM.
    for (const d of this.items.values()) {
      if (d.queueId === id && (d.status === 'stopped' || d.status === 'error')) {
        d.status = 'queued';
        this.changed(d);
      }
    }
    q.running = true;
    this.queuesChanged();
    this.pump();
  }

  async stopQueue(id: string): Promise<void> {
    const q = this.queues.find((x) => x.id === id);
    if (!q) throw new Error('No such queue');
    q.running = false;
    this.queuesChanged();
    await Promise.all([...this.tasks.values()].filter((t) => t.item.queueId === id).map((t) => this.pause(t.item, true)));
  }

  private queuesChanged(): void {
    this.markDirty();
    this.emitEvent({ type: 'queues', queues: this.queues });
  }

  /** Start the next queued items of every running queue, up to its concurrency; finish queues that ran dry. */
  private pump(): void {
    for (const q of this.queues) {
      if (!q.running) continue;
      const mine = [...this.items.values()].filter((d) => d.queueId === q.id);
      let active = mine.filter((d) => this.tasks.has(d.id)).length;
      const waiting = mine.filter((d) => d.status === 'queued' && !this.tasks.has(d.id)).sort((a, b) => a.queueOrder - b.queueOrder);
      for (const d of waiting) {
        if (active >= q.maxConcurrent) break;
        this.startOne(d);
        active++;
      }
      if (active === 0 && waiting.length === 0) {
        q.running = false;
        this.queuesChanged();
        this.emitEvent({ type: 'notify', level: 'info', text: `${q.name} finished` });
      }
    }
  }

  private checkSchedules(): void {
    const now = new Date();
    const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    for (const q of this.queues) {
      const s = q.schedule;
      if (!s.enabled) continue;
      if (s.days.length > 0 && !s.days.includes(now.getDay())) continue;
      if (s.startTime === hhmm && !q.running) this.fire(q, `${day} ${hhmm}:start`, () => this.startQueue(q.id));
      if (s.stopTime === hhmm && q.running) this.fire(q, `${day} ${hhmm}:stop`, () => void this.stopQueue(q.id));
    }
  }

  private fire(q: Queue, key: string, action: () => void): void {
    const k = `${q.id}@${key}`;
    if (this.fired.has(k)) return;
    this.fired.add(k);
    if (this.fired.size > 200) this.fired = new Set([...this.fired].slice(-50));
    action();
    this.emitEvent({ type: 'notify', level: 'info', text: `Scheduler: ${q.name} ${key.endsWith('start') ? 'started' : 'stopped'}` });
  }

  // ------------------------------------------------------------------ progress

  private tick(): void {
    if (this.tasks.size === 0) return;
    const entries: ProgressEntry[] = [];
    let totalSpeed = 0;
    for (const [id, task] of this.tasks) {
      const d = task.item;
      const meter = this.meters.get(id);
      d.speed = meter ? meter.sample(d.received) : 0;
      totalSpeed += d.speed;
      d.eta = d.size !== null && d.speed > 1 ? Math.max(0, Math.round((d.size - d.received) / d.speed)) : null;
      entries.push({ id, status: d.status, received: d.received, size: d.size, speed: d.speed, eta: d.eta, segments: d.segments.map((s) => ({ ...s })) });
    }
    this.markDirty();
    this.emitEvent({ type: 'progress', entries, totalSpeed });
  }
}

export function emptyPost(): DownloadItem['post'] {
  return { step: null, scan: null, extract: null, extractedTo: null, message: null };
}

function emptySchedule(): QueueSchedule {
  return { enabled: false, startTime: null, stopTime: null, days: [] };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function snapshot(d: DownloadItem): DownloadItem {
  return { ...d, segments: d.segments.map((s) => ({ ...s })), headers: { ...d.headers } };
}

function fileNameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : 'download';
  } catch {
    return 'download';
  }
}

const FORBIDDEN_HEADERS = new Set(['host', 'range', 'content-length', 'connection', 'transfer-encoding']);

function sanitizeHeaders(h: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h || typeof h !== 'object') return out;
  for (const [k, v] of Object.entries(h)) {
    if (typeof v !== 'string' || !/^[A-Za-z0-9-]+$/.test(k) || FORBIDDEN_HEADERS.has(k.toLowerCase())) continue;
    if (/[\r\n]/.test(v)) continue;
    out[k] = v;
  }
  return out;
}
