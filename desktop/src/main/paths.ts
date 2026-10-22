import { app } from 'electron';
import * as path from 'node:path';

/** Repo layout in development, resources/ in a packaged build (electron-builder extraResources). */
const root = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..', '..');

export function engineEntry(): string {
  return app.isPackaged ? path.join(root, 'engine', 'engine.cjs') : path.join(root, 'engine', 'dist', 'engine.cjs');
}

export function uiIndex(): string {
  return app.isPackaged ? path.join(root, 'ui', 'index.html') : path.join(root, 'ui', 'dist', 'index.html');
}

export function iconPath(): string {
  return path.join(app.isPackaged ? root : path.join(root, 'desktop', 'build'), process.platform === 'win32' ? 'icon.ico' : 'icon.png');
}

export function trayIconPath(): string {
  return path.join(app.isPackaged ? root : path.join(root, 'desktop', 'build'), 'tray.png');
}

export function dataDir(): string {
  return path.join(app.getPath('userData'), 'data');
}

export function windowStateFile(): string {
  return path.join(app.getPath('userData'), 'window-state.json');
}
