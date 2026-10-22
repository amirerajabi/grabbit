import * as os from 'node:os';
import * as path from 'node:path';
import type { Settings } from '../../../shared/protocol';
import { clamp } from './util';

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export function defaultSettings(): Settings {
  return {
    downloadDir: path.join(os.homedir(), 'Downloads'),
    useCategoryFolders: true,
    maxConnections: 8,
    speedLimit: 0,
    speedLimitEnabled: false,
    maxRetries: 10,
    retryDelaySec: 5,
    timeoutSec: 30,
    userAgent: DEFAULT_USER_AGENT,
    duplicateAction: 'rename',
    showAddDialog: true,
    clipboardMonitor: true,
    notifyOnComplete: true,
    captureExtensions: [
      '3gp', '7z', 'aac', 'ace', 'aif', 'apk', 'arj', 'asf', 'avi', 'bin', 'bz2', 'exe', 'flac', 'flv', 'gz', 'gzip',
      'img', 'iso', 'lzh', 'm4a', 'm4v', 'mkv', 'mov', 'mp3', 'mp4', 'mpeg', 'mpg', 'msi', 'msix', 'ogg', 'pdf', 'rar',
      'rpm', 'deb', 'dmg', 'pkg', 'tar', 'tgz', 'wav', 'webm', 'wma', 'wmv', 'xz', 'zip', 'zst', 'appimage', 'epub',
    ],
    theme: 'system',
    minimizeToTray: true,
  };
}

/** Merge a partial update into the settings, coercing every field to a valid value. */
export function mergeSettings(base: Settings, patch: Partial<Settings>): Settings {
  const s: Settings = { ...base };
  const p = patch as Record<string, unknown>;
  if (typeof p.downloadDir === 'string' && p.downloadDir.trim()) s.downloadDir = p.downloadDir.trim();
  if (typeof p.useCategoryFolders === 'boolean') s.useCategoryFolders = p.useCategoryFolders;
  if (typeof p.maxConnections === 'number') s.maxConnections = clamp(Math.round(p.maxConnections), 1, 32);
  if (typeof p.speedLimit === 'number') s.speedLimit = Math.max(0, Math.round(p.speedLimit));
  if (typeof p.speedLimitEnabled === 'boolean') s.speedLimitEnabled = p.speedLimitEnabled;
  if (typeof p.maxRetries === 'number') s.maxRetries = clamp(Math.round(p.maxRetries), 0, 100);
  if (typeof p.retryDelaySec === 'number') s.retryDelaySec = clamp(Math.round(p.retryDelaySec), 1, 600);
  if (typeof p.timeoutSec === 'number') s.timeoutSec = clamp(Math.round(p.timeoutSec), 5, 600);
  if (typeof p.userAgent === 'string') s.userAgent = p.userAgent.trim() || DEFAULT_USER_AGENT;
  if (p.duplicateAction === 'rename' || p.duplicateAction === 'overwrite') s.duplicateAction = p.duplicateAction;
  if (typeof p.showAddDialog === 'boolean') s.showAddDialog = p.showAddDialog;
  if (typeof p.clipboardMonitor === 'boolean') s.clipboardMonitor = p.clipboardMonitor;
  if (typeof p.notifyOnComplete === 'boolean') s.notifyOnComplete = p.notifyOnComplete;
  if (Array.isArray(p.captureExtensions)) {
    s.captureExtensions = [...new Set(p.captureExtensions.filter((x): x is string => typeof x === 'string').map((x) => x.trim().replace(/^\./, '').toLowerCase()).filter(Boolean))];
  }
  if (p.theme === 'system' || p.theme === 'light' || p.theme === 'dark') s.theme = p.theme;
  if (typeof p.minimizeToTray === 'boolean') s.minimizeToTray = p.minimizeToTray;
  return s;
}
