import { create } from 'zustand';
import type { UpdateStatus } from '../../../shared/protocol';
import { getPlatform } from '../platform';
import { useUi } from './ui';

interface UpdatesState {
  /** Latest status from the desktop app; null in a browser build. */
  status: UpdateStatus | null;
  /** A manual check is running: its outcome is announced (automatic checks stay quiet). */
  manual: boolean;
  setStatus(status: UpdateStatus | null): void;
  check(): Promise<void>;
  install(): Promise<void>;
}

export const useUpdates = create<UpdatesState>((set, get) => ({
  status: null,
  manual: false,
  setStatus(status) {
    const prev = get().status;
    set({ status });
    if (!status || prev?.state === status.state) return;
    if (status.state === 'ready') {
      useUi.getState().toast({ level: 'success', text: `Grabbit ${status.version} is ready`, detail: 'Click “Restart to update” in the status bar, or it installs when you quit.' });
    } else if (status.state === 'available') {
      useUi.getState().toast({ level: 'info', text: `Grabbit ${status.version} is available`, detail: 'Click the update chip in the status bar to download it.' });
    }
  },
  async check() {
    set({ manual: true });
    const s = await getPlatform().checkForUpdates();
    set({ manual: false });
    if (!s) return;
    get().setStatus(s);
    if (s.state === 'up-to-date') useUi.getState().toast({ level: 'success', text: 'Grabbit is up to date', detail: `Version ${s.currentVersion}` });
    else if (s.state === 'error') useUi.getState().toast({ level: 'error', text: 'Could not check for updates', detail: s.message });
  },
  async install() {
    const s = get().status;
    if (s?.state === 'available' && s.releaseUrl) {
      window.open(s.releaseUrl, '_blank');
      return;
    }
    if (!(await getPlatform().installUpdate())) useUi.getState().toast({ level: 'warning', text: 'No update is ready to install yet' });
  },
}));

/** Short label and tone of the status for the status bar chip; null when there is nothing to show. */
export function updateChip(s: UpdateStatus | null): { text: string; tone: 'muted' | 'accent' | 'success' | 'error' } | null {
  if (!s) return null;
  switch (s.state) {
    case 'checking':
      return { text: 'Checking for updates…', tone: 'muted' };
    case 'downloading':
      return { text: `Downloading ${s.version ?? 'update'} · ${s.percent ?? 0}%`, tone: 'accent' };
    case 'ready':
      return { text: `Restart to update to ${s.version}`, tone: 'success' };
    case 'available':
      return { text: `Grabbit ${s.version} available`, tone: 'accent' };
    case 'error':
      return { text: 'Update check failed', tone: 'error' };
    default:
      return null;
  }
}
