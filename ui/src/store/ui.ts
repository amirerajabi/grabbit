import { create } from 'zustand';
import type { WsStatus } from '../api/ws';

export type DockPanel = 'categories' | 'queues';
export type SettingsSection = 'general' | 'connection' | 'saveto' | 'speed' | 'after' | 'logins' | 'integration' | 'updates' | 'about';

export interface AddDialogState {
  url: string;
  fileName?: string;
  referer?: string;
  headers?: Record<string, string>;
  /** Capture request id from the browser extension. */
  captureId?: string;
}

export interface Toast {
  id: number;
  level: 'info' | 'success' | 'warning' | 'error';
  text: string;
  detail?: string;
  downloadId?: string;
}

export interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  /** Optional checkbox (e.g. "Also delete the files"). */
  checkbox?: string;
  resolve(result: { ok: boolean; checked: boolean }): void;
}

export const DOCK_MIN = 180;
export const DOCK_MAX = 420;

interface UiState {
  wsStatus: WsStatus;
  engineError: string | null;
  sidebarVisible: boolean;
  sidebarWidth: number;
  dock: DockPanel;
  detailsVisible: boolean;
  detailsHeight: number;
  addDialog: AddDialogState | null;
  /** Links captured while the Add dialog was busy; each opens in turn. */
  pendingAdds: AddDialogState[];
  batchOpen: boolean;
  /** A site asked for a login (engine event, or "Enter login" on a stopped download). */
  loginPrompt: { downloadId: string | null; site: string; realm: string | null; failed: boolean } | null;
  /** Links handed over by the browser extension ("Download all links"), shown in the Batch dialog to pick from. */
  batchPrefill: { urls: string[]; referer?: string; headers?: Record<string, string> } | null;
  /** Progress of the site grabber's crawl in the Batch dialog. */
  grabProgress: { id: string; pages: number; files: number } | null;
  propertiesFor: string | null;
  queuesOpen: string | null;
  settingsOpen: SettingsSection | null;
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  confirm: ConfirmState | null;
  toasts: Toast[];
  setWsStatus(s: WsStatus): void;
  setEngineError(e: string | null): void;
  setLayout(p: Partial<Pick<UiState, 'sidebarVisible' | 'sidebarWidth' | 'detailsVisible' | 'detailsHeight' | 'dock'>>): void;
  openAdd(s: AddDialogState): void;
  /** Open now, or after the dialog that is already open. */
  queueAdd(s: AddDialogState): void;
  closeAdd(): void;
  set(p: Partial<Pick<UiState, 'batchOpen' | 'loginPrompt' | 'batchPrefill' | 'grabProgress' | 'propertiesFor' | 'queuesOpen' | 'settingsOpen' | 'paletteOpen' | 'shortcutsOpen'>>): void;
  askConfirm(c: Omit<ConfirmState, 'resolve'>): Promise<{ ok: boolean; checked: boolean }>;
  resolveConfirm(ok: boolean, checked?: boolean): void;
  toast(t: Omit<Toast, 'id'>): void;
  dismissToast(id: number): void;
}

const LAYOUT_KEY = 'grabbit.layout';
type Layout = Pick<UiState, 'sidebarVisible' | 'sidebarWidth' | 'detailsVisible' | 'detailsHeight' | 'dock'>;

function loadLayout(): Partial<Layout> {
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') as Partial<Layout>;
  } catch {
    return {};
  }
}

let toastId = 0;

export const useUi = create<UiState>((set, get) => ({
  wsStatus: 'connecting',
  engineError: null,
  sidebarVisible: true,
  sidebarWidth: 0,
  dock: 'categories',
  detailsVisible: true,
  detailsHeight: 0,
  ...loadLayout(),
  addDialog: null,
  pendingAdds: [],
  batchOpen: false,
  loginPrompt: null,
  batchPrefill: null,
  grabProgress: null,
  propertiesFor: null,
  queuesOpen: null,
  settingsOpen: null,
  paletteOpen: false,
  shortcutsOpen: false,
  confirm: null,
  toasts: [],

  setWsStatus: (wsStatus) => set({ wsStatus }),
  setEngineError: (engineError) => set({ engineError }),
  setLayout(p) {
    set(p);
    const s = get();
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({ sidebarVisible: s.sidebarVisible, sidebarWidth: s.sidebarWidth, detailsVisible: s.detailsVisible, detailsHeight: s.detailsHeight, dock: s.dock }));
    } catch {
      /* private mode */
    }
  },
  openAdd: (addDialog) => set({ addDialog }),
  queueAdd(s) {
    const cur = get();
    if (!cur.addDialog) set({ addDialog: s });
    else if (cur.addDialog.url !== s.url && !cur.pendingAdds.some((p) => p.url === s.url)) set({ pendingAdds: [...cur.pendingAdds, s] });
  },
  closeAdd() {
    const [next, ...rest] = get().pendingAdds;
    set({ addDialog: next ?? null, pendingAdds: rest });
  },
  set: (p) => set(p),
  askConfirm(c) {
    get().confirm?.resolve({ ok: false, checked: false });
    return new Promise((resolve) => set({ confirm: { ...c, resolve } }));
  },
  resolveConfirm(ok, checked = false) {
    const c = get().confirm;
    set({ confirm: null });
    c?.resolve({ ok, checked });
  },
  toast(t) {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => get().dismissToast(id), t.level === 'error' ? 9000 : 5000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
