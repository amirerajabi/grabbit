// In-app updates through GitHub Releases (electron-updater reads latest.yml / latest-mac.yml / latest-linux.yml from the
// release that .github/workflows/release.yml publishes). Same flow as Rowlit's updater:
//
//   idle --check--> checking --> up-to-date
//                            \-> install mode: downloading --> ready   (Windows, AppImage, signed macOS: Restart now)
//                            \-> notify mode:  available              (unsigned macOS: open the release page)
//   any --error--> error (logged; automatic checks stay quiet, a manual check shows it)
//   disabled: development runs, smoke tests, GRABBIT_DISABLE_UPDATES=1, Linux outside an AppImage.
//
// GRABBIT_UPDATE_FEED=<url> points the updater at a generic feed (a folder with latest.yml and the installer) instead of
// GitHub, also in unpackaged runs: that is how the flow is tested end to end without publishing a release.
import { app, BrowserWindow } from 'electron';
import { execFile } from 'node:child_process';
import * as path from 'node:path';
import type { UpdateMode, UpdateStatus } from '../../../shared/protocol';
import { CH } from '../shared/channels';

export const RELEASES_URL = 'https://github.com/amirerajabi/grabbit/releases';
const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/** The part of electron-updater's AppUpdater used here. */
interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  logger: unknown;
  on(event: string, listener: (...args: never[]) => void): unknown;
  setFeedURL(options: { provider: 'generic'; url: string }): void;
  checkForUpdates(): Promise<{ isUpdateAvailable?: boolean; updateInfo?: { version?: string } } | null>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

function releasePage(version: string | undefined): string {
  return version && /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version) ? `${RELEASES_URL}/tag/v${version}` : RELEASES_URL;
}

function firstLine(e: unknown): string {
  // electron-updater errors can carry a whole HTTP response; the first line is enough.
  return (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 300);
}

/** Squirrel.Mac only installs into a Developer ID signed app; any other signature means notify mode. */
function macIsDeveloperIdSigned(): Promise<boolean> {
  const bundle = path.resolve(path.dirname(process.execPath), '..', '..');
  return new Promise((resolve) => {
    execFile('/usr/bin/codesign', ['-dv', '--verbose=2', bundle], { timeout: 10_000 }, (_err, stdout, stderr) => {
      const text = `${stdout}\n${stderr}`;
      resolve(/^Authority=Developer ID Application:/m.test(text) && /^TeamIdentifier=(?!not set)\S+/m.test(text));
    });
  });
}

export class Updater {
  private status: UpdateStatus;
  private updater: UpdaterLike | null = null;
  private autoCheck = false;
  private firstTimer: NodeJS.Timeout | null = null;
  private interval: NodeJS.Timeout | null = null;
  private inflight: Promise<UpdateStatus> | null = null;
  private readonly startedAt = Date.now();

  private constructor(private readonly log: (m: string) => void, mode: UpdateMode, reason?: string) {
    const currentVersion = app.getVersion();
    this.status = mode === 'disabled' ? { state: 'disabled', mode, currentVersion, message: reason } : { state: 'idle', mode, currentVersion };
  }

  static async create(log: (m: string) => void, smokeTest: boolean): Promise<Updater> {
    const feed = process.env.GRABBIT_UPDATE_FEED;
    const reason = smokeTest
      ? 'Updates are off during the smoke test.'
      : process.env.GRABBIT_DISABLE_UPDATES === '1'
        ? 'Updates are turned off (GRABBIT_DISABLE_UPDATES).'
        : !app.isPackaged && !feed
          ? 'Updates are only checked in installed builds.'
          : process.platform === 'linux' && !process.env.APPIMAGE
            ? 'Automatic updates need the AppImage build.'
            : null;
    if (reason) {
      log(`updates disabled: ${reason}`);
      return new Updater(log, 'disabled', reason);
    }
    try {
      const mode: UpdateMode = process.platform === 'darwin' && !(await macIsDeveloperIdSigned()) ? 'notify' : 'install';
      const u = new Updater(log, mode);
      const { autoUpdater } = await import('electron-updater');
      u.attach(autoUpdater as unknown as UpdaterLike, feed);
      log(`updates: ${mode} mode, current ${app.getVersion()}${feed ? `, feed ${feed}` : ''}`);
      return u;
    } catch (e) {
      log(`updates disabled: ${firstLine(e)}`);
      return new Updater(log, 'disabled', 'The updater could not be started.');
    }
  }

  private attach(u: UpdaterLike, feed: string | undefined): void {
    this.updater = u;
    const install = this.status.mode === 'install';
    const prefix = (level: string) => (...args: unknown[]) => this.log(`[updater ${level}] ${args.map(String).join(' ')}`);
    u.logger = { info: prefix('info'), warn: prefix('warn'), error: prefix('error'), debug: () => undefined };
    // Install mode: download in the background and install on quit unless the user restarts first.
    u.autoDownload = install;
    u.autoInstallOnAppQuit = install;
    u.allowPrerelease = false;
    if (feed) u.setFeedURL({ provider: 'generic', url: feed });
    u.on('checking-for-update', () => this.set({ state: 'checking' }));
    u.on('update-available', (info: { version?: string }) => {
      const version = info?.version;
      this.log(`update available: ${version}`);
      this.set(install ? { state: 'downloading', version, percent: 0 } : { state: 'available', version, releaseUrl: releasePage(version) });
    });
    u.on('update-not-available', () => this.set({ state: 'up-to-date' }));
    u.on('download-progress', (p: { percent?: number }) => {
      if (this.status.state !== 'downloading') return;
      const percent = Math.max(0, Math.min(100, Math.round(Number(p?.percent) || 0)));
      if (percent !== this.status.percent) this.set({ ...this.status, percent });
    });
    u.on('update-downloaded', (info: { version?: string }) => {
      const version = info?.version ?? this.status.version;
      this.log(`update downloaded: ${version}`);
      this.set({ state: 'ready', version, releaseUrl: releasePage(version) });
    });
    u.on('error', (e: unknown) => this.fail(e));
  }

  get current(): UpdateStatus {
    return this.status;
  }

  /** From the "Check for updates automatically" setting: first check 10 s after start, then every 6 hours. */
  configure(autoCheck: boolean): void {
    if (!this.updater || autoCheck === this.autoCheck) return;
    this.autoCheck = autoCheck;
    this.clearTimers();
    if (!autoCheck) return;
    const delay = Math.max(0, FIRST_CHECK_MS - (Date.now() - this.startedAt));
    this.firstTimer = setTimeout(() => void this.check(), delay);
    this.interval = setInterval(() => void this.check(), CHECK_EVERY_MS);
  }

  /** Never throws: a failure becomes an 'error' status. A download in progress or done is not checked again. */
  check(): Promise<UpdateStatus> {
    const u = this.updater;
    if (!u || this.status.state === 'ready' || this.status.state === 'downloading') return Promise.resolve(this.status);
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        this.set({ state: 'checking' });
        const r = await u.checkForUpdates();
        // electron-updater reports the outcome through events; cover anything it did not.
        if (this.status.state === 'checking') {
          const version = r?.updateInfo?.version;
          if (!r?.isUpdateAvailable) this.set({ state: 'up-to-date' });
          else if (this.status.mode === 'install') this.set({ state: 'downloading', version, percent: 0 });
          else this.set({ state: 'available', version, releaseUrl: releasePage(version) });
        }
      } catch (e) {
        this.fail(e);
      } finally {
        this.inflight = null;
      }
      return this.status;
    })();
    return this.inflight;
  }

  /** Restart into the downloaded version. On Windows the NSIS installer runs silently and relaunches the app. */
  quitAndInstall(): boolean {
    const u = this.updater;
    if (!u || this.status.mode !== 'install' || this.status.state !== 'ready') return false;
    this.log(`restarting to install ${this.status.version}`);
    this.clearTimers();
    u.quitAndInstall(process.platform === 'win32', true);
    return true;
  }

  private fail(e: unknown): void {
    const message = firstLine(e);
    if (this.status.state === 'error' && this.status.message === message) return;
    this.log(`update error: ${message}`);
    // A finished download stays installable even if a later check fails.
    if (this.status.state === 'ready') return;
    this.set({ state: 'error', message });
  }

  private set(next: Omit<UpdateStatus, 'mode' | 'currentVersion'>): void {
    this.status = { ...next, mode: this.status.mode, currentVersion: this.status.currentVersion } as UpdateStatus;
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(CH.updateStatus, this.status);
  }

  private clearTimers(): void {
    if (this.firstTimer) clearTimeout(this.firstTimer);
    if (this.interval) clearInterval(this.interval);
    this.firstTimer = null;
    this.interval = null;
  }
}
