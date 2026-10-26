// Grabbit desktop: starts the engine sidecar, opens the window, and owns the native bits (tray, clipboard watcher,
// notifications, folder picker, taskbar progress).
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, Tray } from 'electron';
import { writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { CH, type Preferences } from '../shared/channels';
import { ClipboardWatcher } from './clipboard';
import { startEngine, stopEngine, type EngineInfo } from './engine-process';
import { iconPath, trayIconPath } from './paths';
import { Updater } from './updater';
import { createMainWindow, DARK, LIGHT, titleBarKind } from './window';

const devUrl = process.env.GRABBIT_DEV_URL;
// Separate profile (tests, portable use): settings, download list and window state all live under it.
if (process.env.GRABBIT_USER_DATA) app.setPath('userData', process.env.GRABBIT_USER_DATA);
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let engine: EngineInfo | null = null;
let quitting = false;
let prefs: Preferences = { clipboardMonitor: true, captureExtensions: [], minimizeToTray: true, autoUpdate: true };
let updater: Updater | null = null;
/** Links handed to us on the command line (`grabbit.exe <url>`) before the UI was ready. */
const pendingLinks: string[] = [];

const watcher = new ClipboardWatcher((url) => {
  // The window decides whether the link is new; if it is, it asks to come to the front (CH.bringToFront).
  win?.webContents.send(CH.clipboardUrl, url);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    showWindow();
    for (const link of linksIn(argv)) win?.webContents.send(CH.clipboardUrl, link);
  });
  void app.whenReady().then(start);
}

function linksIn(argv: string[]): string[] {
  return argv.filter((a) => /^(?:https?|s?ftp):\/\//i.test(a));
}

async function start(): Promise<void> {
  app.setAppUserModelId('com.grabbit.app');
  try {
    engine = await startEngine();
  } catch (e) {
    dialog.showErrorBox('Grabbit', `Could not start the download engine.\n\n${e instanceof Error ? e.message : String(e)}`);
    app.exit(1);
    return;
  }
  pendingLinks.push(...linksIn(process.argv));
  // A smoke test stays offline unless it points the updater at a test feed.
  updater = await Updater.create((m) => console.log(m), !!process.env.GRABBIT_SMOKE_SHOT && !process.env.GRABBIT_UPDATE_FEED);
  installIpc();
  installMenu();
  openWindow();
  createTray();
}

function openWindow(): void {
  if (!engine) return;
  win = createMainWindow(engine, path.join(__dirname, 'preload.js'), devUrl);
  win.webContents.once('did-finish-load', () => {
    for (const link of pendingLinks.splice(0)) win?.webContents.send(CH.clipboardUrl, link);
    const shot = process.env.GRABBIT_SMOKE_SHOT;
    if (shot) smokeShot(shot);
  });
  win.on('close', (e) => {
    // Close = hide to the tray while downloads may be running (the engine keeps working); Quit from the tray exits.
    if (!quitting && prefs.minimizeToTray && tray) {
      e.preventDefault();
      win?.hide();
    }
  });
  win.on('closed', () => {
    win = null;
  });
}

function showWindow(): void {
  if (!win) openWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/**
 * Raise the window over the browser for a captured link, like IDM's download dialog. Windows refuses focus to a
 * background app (it only flashes the taskbar button), but lets a window that is briefly always-on-top come forward.
 */
function bringToFront(): void {
  if (!win) openWindow();
  const w = win;
  if (!w) return;
  if (w.isMinimized()) w.restore();
  if (!w.isVisible()) w.show();
  w.setAlwaysOnTop(true, 'screen-saver');
  w.moveTop();
  w.focus();
  if (process.platform === 'darwin') app.focus({ steal: true });
  // Drop "always on top" once it is in front, so it behaves like any other window again. When Windows kept the keyboard
  // with the app you are typing in, the window is still on top and its taskbar button flashes until you click it.
  setTimeout(() => {
    if (w.isDestroyed()) return;
    w.setAlwaysOnTop(false);
    if (!w.isFocused()) {
      w.flashFrame(true);
      w.once('focus', () => w.flashFrame(false));
    }
  }, 300);
}

function sendCommand(command: string): void {
  showWindow();
  win?.webContents.send(CH.command, command);
}

function createTray(): void {
  const image = nativeImage.createFromPath(trayIconPath());
  if (image.isEmpty()) return;
  tray = new Tray(image.resize({ width: 16, height: 16 }));
  tray.setToolTip('Grabbit');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Grabbit', click: showWindow },
      { label: 'Add URL…', click: () => sendCommand('download.add') },
      { type: 'separator' },
      { label: 'Stop all downloads', click: () => sendCommand('download.pauseAll') },
      { label: 'Options…', click: () => sendCommand('view.settings') },
      { label: 'Check for updates', click: () => sendCommand('app.checkUpdates') },
      { type: 'separator' },
      { label: 'Quit', click: quit },
    ]),
  );
  tray.on('click', showWindow);
}

function installMenu(): void {
  if (process.platform !== 'darwin') {
    // The in-app menu button replaces the menu bar on Windows and Linux.
    Menu.setApplicationMenu(null);
    return;
  }
  const cmd = (label: string, command: string, accelerator?: string): Electron.MenuItemConstructorOptions => ({ label, accelerator, click: () => sendCommand(command) });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { label: 'Tasks', submenu: [cmd('Add URL…', 'download.add', 'CmdOrCtrl+N'), cmd('Batch download…', 'download.batch', 'CmdOrCtrl+Shift+N'), { type: 'separator' }, cmd('Open downloads folder', 'view.openDownloads')] },
      { role: 'editMenu' },
      { label: 'Downloads', submenu: [cmd('Resume', 'download.resume'), cmd('Stop', 'download.pause'), cmd('Stop all', 'download.pauseAll'), { type: 'separator' }, cmd('Scheduler…', 'queue.scheduler')] },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
  );
}

function installIpc(): void {
  ipcMain.handle(CH.chooseFolder, async (e, defaultPath?: string) => {
    const owner = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'], defaultPath: typeof defaultPath === 'string' ? defaultPath : undefined };
    const r = owner ? await dialog.showOpenDialog(owner, opts) : await dialog.showOpenDialog(opts);
    return r.canceled ? null : r.filePaths[0] ?? null;
  });
  ipcMain.on(CH.notify, (_e, title: unknown, body: unknown) => {
    // A toast already shows it inside a focused window.
    if (win?.isFocused() || !Notification.isSupported()) return;
    const n = new Notification({ title: String(title).slice(0, 200), body: String(body).slice(0, 500), icon: iconPath() });
    n.on('click', showWindow);
    n.show();
  });
  ipcMain.on(CH.setProgress, (_e, fraction: unknown) => {
    const f = Number(fraction);
    // -1 removes the bar, > 1 is indeterminate (sizes unknown).
    win?.setProgressBar(Number.isFinite(f) ? f : -1);
  });
  ipcMain.on(CH.setTheme, (_e, theme: unknown, colors: { bg?: unknown; fg?: unknown }) => {
    nativeTheme.themeSource = theme === 'dark' ? 'dark' : 'light';
    if (titleBarKind() !== 'overlay' || !win) return;
    const fallback = theme === 'dark' ? DARK : LIGHT;
    const color = /^#[0-9a-f]{3,8}$/i.test(String(colors?.bg)) ? String(colors.bg) : fallback.bg;
    const symbolColor = /^#[0-9a-f]{3,8}$/i.test(String(colors?.fg)) ? String(colors.fg) : fallback.fg;
    win.setTitleBarOverlay({ color, symbolColor });
    win.setBackgroundColor(color);
  });
  ipcMain.on(CH.setPreferences, (_e, p: Preferences) => {
    prefs = {
      clipboardMonitor: !!p?.clipboardMonitor,
      captureExtensions: Array.isArray(p?.captureExtensions) ? p.captureExtensions.map(String) : [],
      minimizeToTray: !!p?.minimizeToTray,
      autoUpdate: p?.autoUpdate !== false,
    };
    watcher.configure(prefs.clipboardMonitor, prefs.captureExtensions);
    updater?.configure(prefs.autoUpdate);
  });
  ipcMain.on(CH.bringToFront, bringToFront);
  ipcMain.on(CH.quit, quit);
  ipcMain.handle(CH.updateGet, () => updater?.current ?? null);
  ipcMain.handle(CH.updateCheck, () => updater?.check() ?? null);
  ipcMain.handle(CH.updateInstall, () => {
    if (!updater) return false;
    // quitAndInstall quits the app: let the close handler know it is a real quit, not "hide to tray".
    quitting = true;
    const ok = updater.quitAndInstall();
    if (!ok) quitting = false;
    return ok;
  });
  ipcMain.on(CH.appVersion, (e) => {
    e.returnValue = app.getVersion();
  });
  ipcMain.on(CH.readClipboard, (e) => {
    e.returnValue = clipboard.readText();
  });
}

function quit(): void {
  quitting = true;
  app.quit();
}

/** Smoke test (GRABBIT_SMOKE_SHOT=<file.png>): let the UI connect to the engine, capture the window, quit. */
function smokeShot(file: string): void {
  setTimeout(async () => {
    try {
      const image = await win!.webContents.capturePage();
      writeFileSync(file, image.toPNG());
      console.log(`smoke: wrote ${file}`);
    } catch (e) {
      console.error('smoke: capture failed', e);
      process.exitCode = 1;
    }
    quit();
  }, Number(process.env.GRABBIT_SMOKE_DELAY_MS) || 3000);
}

app.on('before-quit', (e) => {
  quitting = true;
  if (!engine) return;
  // Let the engine pause every download and save its state before the app exits.
  e.preventDefault();
  engine = null;
  watcher.stop();
  void stopEngine().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (!tray || !prefs.minimizeToTray) quit();
});

app.on('activate', showWindow);
