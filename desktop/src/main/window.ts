// Main window: hardened webPreferences, navigation lock, window-state persistence, and a background colour that matches
// the OS theme so there is no white flash before the UI paints.
import { BrowserWindow, nativeTheme, screen, shell, type Rectangle } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ARG } from '../shared/channels';
import type { EngineInfo } from './engine-process';
import { iconPath, uiIndex, windowStateFile } from './paths';

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

const DEFAULT_STATE: WindowState = { width: 1280, height: 800, maximized: false };
export const DARK = { bg: '#1b1d21', fg: '#e6e8eb' };
export const LIGHT = { bg: '#f5f6f8', fg: '#1c1f24' };
export const TOPBAR_H = 40;

function loadState(): WindowState {
  try {
    const s = JSON.parse(fs.readFileSync(windowStateFile(), 'utf8')) as Partial<WindowState>;
    const width = Number(s.width);
    const height = Number(s.height);
    if (!(width >= 640 && height >= 420)) return DEFAULT_STATE;
    const state: WindowState = { width, height, maximized: s.maximized === true };
    if (Number.isFinite(s.x) && Number.isFinite(s.y)) {
      const bounds: Rectangle = { x: s.x!, y: s.y!, width, height };
      // Restore the position only if the window would still be mostly visible (monitor unplugged, etc.).
      const area = screen.getDisplayMatching(bounds).workArea;
      const visibleW = Math.min(bounds.x + width, area.x + area.width) - Math.max(bounds.x, area.x);
      const visibleH = Math.min(bounds.y + height, area.y + area.height) - Math.max(bounds.y, area.y);
      if (visibleW >= 200 && visibleH >= 100) {
        state.x = s.x;
        state.y = s.y;
      }
    }
    return state;
  } catch {
    return DEFAULT_STATE;
  }
}

function trackState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | undefined;
  const save = () => {
    const b = win.getNormalBounds();
    const state: WindowState = { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() };
    try {
      fs.mkdirSync(path.dirname(windowStateFile()), { recursive: true });
      fs.writeFileSync(windowStateFile(), JSON.stringify(state));
    } catch {
      /* best effort */
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 500);
  };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize'] as const) win.on(ev as 'resize', schedule);
  win.on('close', () => {
    clearTimeout(timer);
    save();
  });
}

export function titleBarKind(): 'overlay' | 'inset' | null {
  if (process.platform === 'win32') return 'overlay';
  if (process.platform === 'darwin') return 'inset';
  return null;
}

export function createMainWindow(engine: EngineInfo, preloadPath: string, devUrl?: string): BrowserWindow {
  const state = loadState();
  const colors = nativeTheme.shouldUseDarkColors ? DARK : LIGHT;
  const kind = titleBarKind();
  const win = new BrowserWindow({
    ...state,
    minWidth: 720,
    minHeight: 460,
    show: false,
    title: 'Grabbit',
    icon: iconPath(),
    backgroundColor: colors.bg,
    // Frameless top: our glass top bar is the title bar; Windows draws its caption buttons over it, macOS its lights.
    titleBarStyle: kind ? (kind === 'inset' ? 'hiddenInset' : 'hidden') : 'default',
    titleBarOverlay: kind === 'overlay' ? { color: colors.bg, symbolColor: colors.fg, height: TOPBAR_H } : false,
    trafficLightPosition: kind === 'inset' ? { x: 14, y: 13 } : undefined,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      additionalArguments: [`${ARG.engine}${engine.url}`, `${ARG.token}${engine.token}`, `${ARG.titleBar}${kind ?? ''}`],
    },
  });
  if (state.maximized) win.maximize();
  trackState(win);

  // Never navigate away from the app; links open in the default browser.
  const allowed = devUrl ? new URL(devUrl).origin : 'file://';
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(allowed)) {
      e.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) win.show();
  });
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(uiIndex());
  return win;
}
