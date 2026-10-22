import type { UpdateStatus } from '../../shared/protocol';

/**
 * What the UI needs from its host. In Electron the preload script exposes `window.grabbit`; in a plain browser
 * (npm run dev) the fallbacks below talk to the dev engine and skip the native bits.
 */
export interface DesktopBridge {
  engineUrl: string;
  token: string;
  os: 'win32' | 'darwin' | 'linux';
  /** How the window draws its caption buttons over our top bar. */
  titleBar: 'overlay' | 'inset' | null;
  chooseFolder(defaultPath?: string): Promise<string | null>;
  notify(title: string, body: string): void;
  setProgress(fraction: number): void;
  setTheme(theme: 'light' | 'dark', colors: { bg: string; fg: string }): void;
  /** Settings the desktop shell acts on itself (clipboard watcher, close-to-tray, update checks). */
  setPreferences(p: { clipboardMonitor: boolean; captureExtensions: string[]; minimizeToTray: boolean; autoUpdate: boolean }): void;
  /** The desktop app's version ('' in a browser). */
  appVersion: string;
  /** null: no updater (browser build). */
  getUpdateStatus(): Promise<UpdateStatus | null>;
  checkForUpdates(): Promise<UpdateStatus | null>;
  /** Restart into a downloaded update; false when there is none. */
  installUpdate(): Promise<boolean>;
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void;
  onClipboardUrl(cb: (url: string) => void): () => void;
  onCommand(cb: (command: string) => void): () => void;
  readClipboard(): string;
}

declare global {
  interface Window {
    grabbit?: DesktopBridge;
  }
}

export interface Platform extends DesktopBridge {
  kind: 'electron' | 'browser';
}

const noop = () => undefined;

function browserPlatform(): Platform {
  const env = import.meta.env;
  return {
    kind: 'browser',
    engineUrl: (env.VITE_ENGINE_URL as string | undefined) ?? 'http://127.0.0.1:7310',
    token: (env.VITE_ENGINE_TOKEN as string | undefined) ?? 'dev',
    os: /Mac/.test(navigator.platform) ? 'darwin' : /Win/.test(navigator.platform) ? 'win32' : 'linux',
    titleBar: null,
    chooseFolder: async () => null,
    notify: (title, body) => {
      if (document.hasFocus() || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      new Notification(title, { body });
    },
    setProgress: noop,
    setTheme: noop,
    setPreferences: noop,
    appVersion: '',
    getUpdateStatus: async () => null,
    checkForUpdates: async () => null,
    installUpdate: async () => false,
    onUpdateStatus: () => noop,
    onClipboardUrl: () => noop,
    onCommand: () => noop,
    readClipboard: () => '',
  };
}

let current: Platform | null = null;

export function getPlatform(): Platform {
  if (!current) current = window.grabbit ? { ...window.grabbit, kind: 'electron' } : browserPlatform();
  return current;
}

/** Clipboard text: native in Electron, the async API (may prompt) in a browser. */
export async function readClipboardText(): Promise<string> {
  const p = getPlatform();
  if (p.kind === 'electron') return p.readClipboard();
  try {
    return await navigator.clipboard.readText();
  } catch {
    return '';
  }
}
