import {
  CalendarClock,
  ClipboardCopy,
  Download,
  FileStack,
  FolderOpen,
  Gauge,
  Keyboard,
  ListChecks,
  ListX,
  PanelBottom,
  PanelLeft,
  Pause,
  PauseCircle,
  Play,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  SquareArrowOutUpRight,
  SunMoon,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type { DownloadItem } from '../../../shared/protocol';
import { api } from '../api/client';
import { getPlatform, readClipboardText } from '../platform';
import { ACTIVE, useDownloads, visibleItems } from '../store/downloads';
import { useEngine } from '../store/engine';
import { useUi } from '../store/ui';
import { useUpdates } from '../store/updates';
import { formatSpeed } from '../lib/format';
import { matches } from './keys';

export interface Command {
  id: string;
  label: string;
  icon?: LucideIcon;
  shortcut?: string;
  /** Shown in the palette; false hides it there. */
  palette?: boolean;
  /** Why it is unavailable right now, or null when it can run. */
  disabled?: () => string | null;
  run: () => unknown;
}

export function selectedItems(): DownloadItem[] {
  const { items, selected } = useDownloads.getState();
  return selected.map((id) => items[id]).filter((d): d is DownloadItem => !!d);
}

/** Run an engine call and surface its error as a toast. */
export async function attempt<T>(fn: () => Promise<T>, failure = 'Action failed'): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    useUi.getState().toast({ level: 'error', text: failure, detail: e instanceof Error ? e.message : String(e) });
    return undefined;
  }
}

const canResume = (d: DownloadItem) => d.status === 'stopped' || d.status === 'error' || d.status === 'queued';
const canPause = (d: DownloadItem) => ACTIVE.has(d.status) || d.status === 'queued';
const noSelection = () => (useDownloads.getState().selected.length === 0 ? 'Select a download first' : null);

/** The queue the toolbar's Start/Stop queue buttons act on: the one shown in the list, else the main queue. */
export function currentQueueId(): string {
  const f = useDownloads.getState().filter;
  return f.kind === 'queue' ? f.id : 'main';
}

export async function openAddDialog(): Promise<void> {
  const text = (await readClipboardText()).trim();
  const url = /^(?:https?|s?ftp):\/\/\S+$/i.test(text) ? text : '';
  useUi.getState().openAdd({ url });
}

export async function deleteDownloads(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const items = useDownloads.getState().items;
  const anyDone = ids.some((id) => items[id]?.status === 'completed');
  const name = ids.length === 1 ? `"${items[ids[0]]?.fileName}"` : `${ids.length} downloads`;
  const r = await useUi.getState().askConfirm({
    title: ids.length === 1 ? 'Delete download' : 'Delete downloads',
    message: `Remove ${name} from the list? Unfinished parts are deleted.`,
    confirmLabel: 'Delete',
    danger: true,
    checkbox: anyDone ? 'Also delete the downloaded files from disk' : undefined,
  });
  if (!r.ok) return;
  await attempt(() => api.bulk(ids, r.checked ? 'delete' : 'remove'), 'Could not delete');
}

function toggleTheme(): void {
  const pref = useEngine.getState().settings?.theme ?? 'system';
  const next = pref === 'system' ? 'dark' : pref === 'dark' ? 'light' : 'system';
  void attempt(() => useEngine.getState().updateSettings({ theme: next }));
}

export const COMMANDS: Command[] = [
  { id: 'download.add', label: 'Add URL…', icon: Download, shortcut: 'Mod+N', run: openAddDialog },
  { id: 'download.batch', label: 'Batch download…', icon: FileStack, shortcut: 'Mod+Shift+N', run: () => useUi.getState().set({ batchOpen: true }) },
  {
    id: 'download.resume',
    label: 'Resume',
    icon: Play,
    disabled: () => noSelection() ?? (selectedItems().some(canResume) ? null : 'Nothing to resume in the selection'),
    run: () => attempt(() => api.bulk(selectedItems().filter(canResume).map((d) => d.id), 'start')),
  },
  {
    id: 'download.pause',
    label: 'Stop',
    icon: Pause,
    disabled: () => noSelection() ?? (selectedItems().some(canPause) ? null : 'Nothing running in the selection'),
    run: () => attempt(() => api.bulk(selectedItems().filter(canPause).map((d) => d.id), 'pause')),
  },
  {
    id: 'download.toggle',
    label: 'Resume or stop',
    shortcut: 'Space',
    palette: false,
    disabled: noSelection,
    run: () => {
      const sel = selectedItems();
      const running = sel.filter(canPause);
      return running.length
        ? attempt(() => api.bulk(running.map((d) => d.id), 'pause'))
        : attempt(() => api.bulk(sel.filter(canResume).map((d) => d.id), 'start'));
    },
  },
  {
    id: 'download.pauseAll',
    label: 'Stop all',
    icon: PauseCircle,
    disabled: () => (Object.values(useDownloads.getState().items).some((d) => canPause(d)) ? null : 'Nothing is downloading'),
    run: () => attempt(() => api.pauseAll()),
  },
  { id: 'download.delete', label: 'Delete', icon: Trash2, shortcut: 'Delete', disabled: noSelection, run: () => deleteDownloads(useDownloads.getState().selected) },
  {
    id: 'download.deleteCompleted',
    label: 'Delete completed',
    icon: ListX,
    disabled: () => (Object.values(useDownloads.getState().items).some((d) => d.status === 'completed') ? null : 'No completed downloads'),
    run: async () => {
      const r = await useUi.getState().askConfirm({
        title: 'Delete completed',
        message: 'Remove every completed download from the list? The files stay on disk.',
        confirmLabel: 'Remove',
      });
      if (r.ok) await attempt(() => api.removeCompleted());
    },
  },
  { id: 'download.redownload', label: 'Redownload', icon: RotateCcw, disabled: noSelection, run: () => attempt(() => api.bulk(useDownloads.getState().selected, 'redownload')) },
  {
    id: 'download.open',
    label: 'Open file',
    icon: SquareArrowOutUpRight,
    shortcut: 'Enter',
    disabled: () => (selectedItems()[0]?.status === 'completed' ? null : 'The download is not finished'),
    run: () => attempt(() => api.open(selectedItems()[0].id, false), 'Could not open the file'),
  },
  { id: 'download.openFolder', label: 'Open folder', icon: FolderOpen, disabled: noSelection, run: () => attempt(() => api.open(selectedItems()[0].id, true), 'Could not open the folder') },
  {
    id: 'download.copyUrl',
    label: 'Copy address',
    icon: ClipboardCopy,
    disabled: noSelection,
    run: async () => {
      await navigator.clipboard.writeText(selectedItems().map((d) => d.url).join('\n'));
      useUi.getState().toast({ level: 'info', text: 'Address copied' });
    },
  },
  { id: 'download.properties', label: 'Properties…', shortcut: 'Alt+Enter', disabled: noSelection, run: () => useUi.getState().set({ propertiesFor: useDownloads.getState().selected[0] }) },
  {
    id: 'download.selectAll',
    label: 'Select all',
    shortcut: 'Mod+A',
    palette: false,
    run: () => useDownloads.getState().select(visibleItems(useDownloads.getState()).map((d) => d.id)),
  },
  {
    id: 'queue.start',
    label: 'Start queue',
    icon: PlayCircle,
    disabled: () => (useEngine.getState().queues.find((q) => q.id === currentQueueId())?.running ? 'The queue is already running' : null),
    run: () => attempt(() => api.startQueue(currentQueueId())),
  },
  {
    id: 'queue.stop',
    label: 'Stop queue',
    icon: ListChecks,
    disabled: () => (useEngine.getState().queues.find((q) => q.id === currentQueueId())?.running ? null : 'The queue is not running'),
    run: () => attempt(() => api.stopQueue(currentQueueId())),
  },
  { id: 'queue.scheduler', label: 'Scheduler…', icon: CalendarClock, shortcut: 'Mod+Shift+S', run: () => useUi.getState().set({ queuesOpen: currentQueueId() }) },
  {
    id: 'speed.toggle',
    label: 'Toggle speed limiter',
    icon: Gauge,
    run: async () => {
      const s = useEngine.getState().settings;
      if (!s) return;
      if (!s.speedLimit) {
        useUi.getState().set({ settingsOpen: 'speed' });
        return;
      }
      await attempt(() => useEngine.getState().updateSettings({ speedLimitEnabled: !s.speedLimitEnabled }));
      useUi.getState().toast({ level: 'info', text: s.speedLimitEnabled ? 'Speed limiter off' : `Speed limited to ${formatSpeed(s.speedLimit)}` });
    },
  },
  { id: 'view.openDownloads', label: 'Open downloads folder', icon: FolderOpen, run: () => attempt(() => api.openFolder(), 'Could not open the folder') },
  { id: 'view.palette', label: 'Command palette', icon: Search, shortcut: 'Mod+K', palette: false, run: () => useUi.getState().set({ paletteOpen: true }) },
  { id: 'view.focusFilter', label: 'Filter downloads', icon: Search, shortcut: 'Mod+F', run: () => document.getElementById('list-filter')?.focus() },
  { id: 'view.toggleSidebar', label: 'Toggle side panel', icon: PanelLeft, shortcut: 'Mod+B', run: () => useUi.getState().setLayout({ sidebarVisible: !useUi.getState().sidebarVisible }) },
  { id: 'view.toggleDetails', label: 'Toggle details pane', icon: PanelBottom, shortcut: 'Mod+J', run: () => useUi.getState().setLayout({ detailsVisible: !useUi.getState().detailsVisible }) },
  { id: 'view.toggleTheme', label: 'Switch theme (system / dark / light)', icon: SunMoon, run: toggleTheme },
  { id: 'view.settings', label: 'Options…', icon: Settings, shortcut: 'Mod+,', run: () => useUi.getState().set({ settingsOpen: 'general' }) },
  {
    id: 'app.checkUpdates',
    label: 'Check for updates',
    icon: RefreshCw,
    disabled: () => (getPlatform().kind === 'electron' ? null : 'Updates are part of the desktop app'),
    run: () => {
      useUi.getState().set({ settingsOpen: 'updates' });
      return useUpdates.getState().check();
    },
  },
  { id: 'view.shortcuts', label: 'Keyboard shortcuts', icon: Keyboard, shortcut: 'Mod+/', run: () => useUi.getState().set({ shortcutsOpen: true }) },
];

const byId = new Map(COMMANDS.map((c) => [c.id, c]));

export function getCommand(id: string): Command | undefined {
  return byId.get(id);
}

export function runCommand(id: string): void {
  const c = byId.get(id);
  if (!c || c.disabled?.()) return;
  void c.run();
}

function modalOpen(): boolean {
  const u = useUi.getState();
  return !!(u.addDialog || u.batchOpen || u.propertiesFor || u.queuesOpen || u.settingsOpen || u.paletteOpen || u.shortcutsOpen || u.confirm);
}

/** Global shortcuts. List-only keys (Space, Enter, Delete, Mod+A) fire only while focus is in the download list. */
const LIST_ONLY = new Set(['download.toggle', 'download.open', 'download.delete', 'download.selectAll', 'download.properties']);

export function installKeyboard(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    const inList = !!(document.activeElement as HTMLElement | null)?.closest?.('.dl-list');
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '');
    for (const c of COMMANDS) {
      if (!c.shortcut || !matches(e, c.shortcut)) continue;
      if (LIST_ONLY.has(c.id) && (!inList || typing)) continue;
      if (modalOpen() && c.id !== 'view.palette') continue;
      if (typing && !c.shortcut.includes('Mod')) continue;
      e.preventDefault();
      runCommand(c.id);
      return;
    }
  };
  window.addEventListener('keydown', onKey);
  const offMenu = getPlatform().onCommand((id) => runCommand(id));
  return () => {
    window.removeEventListener('keydown', onKey);
    offMenu();
  };
}
