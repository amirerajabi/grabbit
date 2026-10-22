// Preload (sandboxed): exposes `window.grabbit`, the only bridge between the UI and Electron.
import { contextBridge, ipcRenderer } from 'electron';
import { ARG, CH, type Preferences } from '../shared/channels';

function arg(prefix: string): string {
  const a = process.argv.find((x) => x.startsWith(prefix));
  return a ? a.slice(prefix.length) : '';
}

const titleBar = arg(ARG.titleBar);

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const listener = (_e: unknown, value: T) => cb(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('grabbit', {
  engineUrl: arg(ARG.engine),
  token: arg(ARG.token),
  os: process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux',
  titleBar: titleBar === 'overlay' || titleBar === 'inset' ? titleBar : null,
  chooseFolder: (defaultPath?: string): Promise<string | null> => ipcRenderer.invoke(CH.chooseFolder, typeof defaultPath === 'string' ? defaultPath : undefined),
  notify: (title: string, body: string) => ipcRenderer.send(CH.notify, String(title), String(body)),
  setProgress: (fraction: number) => ipcRenderer.send(CH.setProgress, Number(fraction)),
  setTheme: (theme: 'light' | 'dark', colors: { bg: string; fg: string }) => ipcRenderer.send(CH.setTheme, theme, { bg: String(colors.bg), fg: String(colors.fg) }),
  setPreferences: (p: Preferences) =>
    ipcRenderer.send(CH.setPreferences, {
      clipboardMonitor: !!p.clipboardMonitor,
      captureExtensions: Array.isArray(p.captureExtensions) ? p.captureExtensions.map(String) : [],
      minimizeToTray: !!p.minimizeToTray,
      autoUpdate: p.autoUpdate !== false,
    }),
  appVersion: ipcRenderer.sendSync(CH.appVersion) as string,
  bringToFront: () => ipcRenderer.send(CH.bringToFront),
  getUpdateStatus: () => ipcRenderer.invoke(CH.updateGet),
  checkForUpdates: () => ipcRenderer.invoke(CH.updateCheck),
  installUpdate: (): Promise<boolean> => ipcRenderer.invoke(CH.updateInstall),
  onUpdateStatus: (cb: (status: unknown) => void) => subscribe<unknown>(CH.updateStatus, cb),
  readClipboard: (): string => ipcRenderer.sendSync(CH.readClipboard),
  onClipboardUrl: (cb: (url: string) => void) => subscribe<string>(CH.clipboardUrl, cb),
  onCommand: (cb: (command: string) => void) => subscribe<string>(CH.command, cb),
});
