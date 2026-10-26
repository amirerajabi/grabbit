/*
 * Wire contract between the Grabbit engine and the UI (REST + WebSocket). Types only: both sides import it with
 * `import type`, so nothing here exists at runtime.
 */

export type CategoryId = 'general' | 'compressed' | 'documents' | 'music' | 'programs' | 'video';

export type DownloadStatus =
  | 'stopped' // added but not started, or paused by the user
  | 'queued' // waiting for a free slot in its queue
  | 'connecting' // probing / opening connections
  | 'downloading'
  | 'completing' // last bytes flushed, renaming the temp file
  | 'completed'
  | 'error';

/** One byte range of the file. `end` is inclusive; -1 while the size is unknown (single stream). */
export interface Segment {
  start: number;
  end: number;
  received: number;
  /** A connection is currently filling this range. */
  active: boolean;
}

export interface DownloadItem {
  id: string;
  url: string;
  /** Last URL after redirects (what the segments request). */
  finalUrl: string | null;
  fileName: string;
  dir: string;
  category: CategoryId;
  size: number | null;
  received: number;
  status: DownloadStatus;
  error: string | null;
  /** The server honours Range requests: pausing keeps the bytes and several connections can share the file. */
  resumable: boolean;
  /** Maximum parallel connections for this download. */
  connections: number;
  segments: Segment[];
  /** Bytes/s, smoothed. 0 when idle. */
  speed: number;
  /** Seconds left, null when unknown. */
  eta: number | null;
  mime: string | null;
  referer: string | null;
  headers: Record<string, string>;
  description: string;
  queueId: string | null;
  /** Position inside its queue (lower starts first). */
  queueOrder: number;
  /** Bytes/s cap for this download; 0 = no limit. */
  speedLimit: number;
  addedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  /** Time spent transferring, ms (used for the average speed). */
  activeMs: number;
  retries: number;
  /** Checksum to verify after the download (or computed on request); null = none. */
  checksum: ChecksumInfo | null;
  /** What happened after the bytes arrived: verification, virus scan, extraction. */
  post: PostInfo;
  /** Open the file with its default app when it finishes. */
  openWhenDone: boolean;
  /** Extract this archive when it finishes; null = follow the setting. */
  extract: boolean | null;
}

export type HashAlgo = 'md5' | 'sha1' | 'sha256' | 'sha512';

export interface ChecksumInfo {
  algo: HashAlgo;
  /** Lower-case hex the file must match; null when the hash is only computed, not checked. */
  expected: string | null;
  actual: string | null;
  state: 'pending' | 'computing' | 'ok' | 'mismatch' | 'computed' | 'failed';
}

export interface PostInfo {
  /** The step running now, null when post-processing is finished (or never ran). */
  step: 'verifying' | 'scanning' | 'extracting' | null;
  scan: 'clean' | 'threat' | 'failed' | null;
  extract: 'done' | 'failed' | 'password' | null;
  /** Folder the archive was extracted to. */
  extractedTo: string | null;
  /** Detail for a failed or flagged step (shown in the details pane). */
  message: string | null;
}

/** One-shot action when every download has finished (IDM's "turn off the computer when done"). */
export type WhenDoneAction = 'nothing' | 'quit' | 'sleep' | 'hibernate' | 'shutdown';

/** Live numbers for running downloads, pushed every ~500 ms. */
export interface ProgressEntry {
  id: string;
  status: DownloadStatus;
  received: number;
  size: number | null;
  speed: number;
  eta: number | null;
  segments: Segment[];
}

export interface QueueSchedule {
  enabled: boolean;
  /** "HH:mm" local time, null = start manually. */
  startTime: string | null;
  /** "HH:mm" local time, null = run until the queue is empty. */
  stopTime: string | null;
  /** 0 = Sunday ... 6 = Saturday; empty = every day. */
  days: number[];
}

export interface Queue {
  id: string;
  name: string;
  maxConcurrent: number;
  running: boolean;
  schedule: QueueSchedule;
  /** Built-in queues cannot be deleted. */
  builtIn: boolean;
}

export type DuplicateAction = 'rename' | 'overwrite';
export type ThemePref = 'system' | 'light' | 'dark';

export interface Settings {
  downloadDir: string;
  useCategoryFolders: boolean;
  maxConnections: number;
  /** Global bytes/s cap; 0 = no limit. */
  speedLimit: number;
  speedLimitEnabled: boolean;
  maxRetries: number;
  retryDelaySec: number;
  timeoutSec: number;
  userAgent: string;
  duplicateAction: DuplicateAction;
  showAddDialog: boolean;
  clipboardMonitor: boolean;
  notifyOnComplete: boolean;
  /** Extensions (no dot) that browser capture and clipboard monitoring react to. */
  captureExtensions: string[];
  theme: ThemePref;
  minimizeToTray: boolean;
  /** Check GitHub Releases for a new version at start and every few hours (desktop app). */
  autoUpdate: boolean;
  /** What to do once every running download has finished; resets to 'nothing' after it fires. */
  whenDone: WhenDoneAction;
  /** Scan each finished file with an antivirus. */
  scanAfterDownload: boolean;
  /** Scanner command with {file} for the path; '' = Microsoft Defender on Windows. */
  scanCommand: string;
  /** Extract ZIP, 7z and RAR archives when they finish. */
  extractArchives: boolean;
  /** Move the archive to the trash/delete it after a successful extraction. */
  deleteArchiveAfterExtract: boolean;
}

/**
 * In-app updates (desktop): `install` downloads in the background and restarts into the new version (Windows, the
 * Linux AppImage, signed macOS builds); `notify` only announces it with a link (unsigned macOS builds, which macOS
 * refuses to update in place); `disabled` in development and unsupported builds.
 */
export type UpdateMode = 'install' | 'notify' | 'disabled';

export interface UpdateStatus {
  state: 'disabled' | 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error';
  mode: UpdateMode;
  currentVersion: string;
  /** The newer version, once one is found. */
  version?: string;
  /** Download progress, 0-100. */
  percent?: number;
  /** Why updates are disabled, or what went wrong. */
  message?: string;
  releaseUrl?: string;
}

export interface CategoryInfo {
  id: CategoryId;
  label: string;
  extensions: string[];
}

export interface ProbeResult {
  url: string;
  finalUrl: string;
  fileName: string;
  size: number | null;
  resumable: boolean;
  mime: string | null;
  category: CategoryId;
  /** Directory the file would be saved to with the current settings. */
  dir: string;
}

export interface AddDownloadRequest {
  url: string;
  fileName?: string;
  dir?: string;
  category?: CategoryId;
  /** now = start immediately, queue = add to `queueId` (main by default), none = just add it, stopped. */
  start?: 'now' | 'queue' | 'none';
  queueId?: string;
  connections?: number;
  referer?: string;
  headers?: Record<string, string>;
  description?: string;
  /** Probe result from the Add dialog, so the engine does not ask the server twice. */
  probe?: Pick<ProbeResult, 'finalUrl' | 'size' | 'resumable' | 'mime'>;
  /** Expected checksum: hex (the algorithm follows from its length) or "sha256:<hex>". */
  checksum?: string;
  openWhenDone?: boolean;
  extract?: boolean | null;
}

export type BulkAction = 'start' | 'pause' | 'remove' | 'delete' | 'redownload' | 'moveToQueue' | 'moveUp' | 'moveDown';

export interface CaptureRequest {
  id: string;
  url: string;
  /** "Download all links": several addresses at once; they open in the Batch dialog to pick from. */
  urls?: string[];
  fileName?: string;
  referer?: string;
  headers?: Record<string, string>;
  source: 'browser' | 'clipboard';
}

export interface EngineState {
  downloads: DownloadItem[];
  queues: Queue[];
  settings: Settings;
  categories: CategoryInfo[];
  version: string;
  /** A when-done countdown in progress. */
  whenDone: { action: WhenDoneAction; at: number } | null;
}

export type EngineEvent =
  | { type: 'download.added'; item: DownloadItem }
  | { type: 'download.updated'; item: DownloadItem }
  | { type: 'download.removed'; ids: string[] }
  | { type: 'progress'; entries: ProgressEntry[]; totalSpeed: number }
  | { type: 'queues'; queues: Queue[] }
  | { type: 'settings'; settings: Settings }
  | { type: 'capture'; request: CaptureRequest }
  | { type: 'notify'; level: 'info' | 'success' | 'warning' | 'error'; text: string; detail?: string; downloadId?: string }
  /** The when-done action will run at `at` (ms) unless cancelled; `at` null = cancelled. */
  | { type: 'whenDone'; action: WhenDoneAction; at: number | null }
  /** The when-done action was "quit": the desktop app should exit. */
  | { type: 'quit' };
