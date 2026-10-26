import type { EngineEvent } from '../../../shared/protocol';
import { api } from '../api/client';
import { connectEvents } from '../api/ws';
import { getPlatform } from '../platform';
import { ACTIVE, useDownloads } from '../store/downloads';
import { useEngine } from '../store/engine';
import { useUi } from '../store/ui';
import { useUpdates } from '../store/updates';

async function loadState(): Promise<void> {
  try {
    const state = await api.state();
    useEngine.getState().load(state);
    useDownloads.getState().setAll(state.downloads);
    useUi.getState().setEngineError(null);
    syncPreferences();
  } catch (e) {
    useUi.getState().setEngineError(e instanceof Error ? e.message : String(e));
  }
}

function syncPreferences(): void {
  const s = useEngine.getState().settings;
  if (s) getPlatform().setPreferences({ clipboardMonitor: s.clipboardMonitor, captureExtensions: s.captureExtensions, minimizeToTray: s.minimizeToTray, autoUpdate: s.autoUpdate });
}

/** Overall progress of what is running, for the taskbar / dock icon. */
function updateTaskbar(): void {
  let size = 0;
  let received = 0;
  let any = false;
  for (const d of Object.values(useDownloads.getState().items)) {
    if (!ACTIVE.has(d.status)) continue;
    any = true;
    if (d.size) {
      size += d.size;
      received += d.received;
    }
  }
  getPlatform().setProgress(any ? (size ? received / size : 2) : -1);
}

function onEvent(e: EngineEvent): void {
  switch (e.type) {
    case 'settings':
      useEngine.getState().setSettings(e.settings);
      syncPreferences();
      return;
    case 'tools':
      useEngine.getState().setTools(e.tools);
      break;
    case 'whenDone':
      useEngine.getState().setWhenDone(e.at === null ? null : { action: e.action, at: e.at });
      return;
    case 'login.required':
      getPlatform().bringToFront();
      useUi.getState().set({ loginPrompt: { downloadId: e.downloadId, site: e.site, realm: e.realm, failed: e.failed } });
      return;
    case 'quit':
      getPlatform().quit();
      return;
    case 'queues':
      useEngine.getState().setQueues(e.queues);
      return;
    case 'capture':
      // A link from the browser: show the dialog over the browser, like IDM, not inside a hidden window.
      getPlatform().bringToFront();
      if (e.request.urls) {
        useUi.getState().set({ batchOpen: true, batchPrefill: { urls: e.request.urls, referer: e.request.referer, headers: e.request.headers } });
        return;
      }
      useUi.getState().queueAdd({ url: e.request.url, fileName: e.request.fileName, referer: e.request.referer, headers: e.request.headers, captureId: e.request.id });
      return;
    case 'notify': {
      useUi.getState().toast({ level: e.level, text: e.text, detail: e.detail, downloadId: e.downloadId });
      const notifyOn = useEngine.getState().settings?.notifyOnComplete ?? true;
      if (notifyOn && (e.level === 'success' || e.level === 'error')) getPlatform().notify(e.text, e.detail ?? '');
      return;
    }
    default:
      useDownloads.getState().apply(e);
      if (e.type === 'progress' || e.type === 'download.updated') updateTaskbar();
  }
}

let started = false;

export function boot(): void {
  if (started) return;
  started = true;
  connectEvents(onEvent, loadState);
  // In-app updates (desktop): the current state now, then every change the main process pushes.
  const platform = getPlatform();
  void platform.getUpdateStatus().then((s) => s && useUpdates.getState().setStatus(s));
  platform.onUpdateStatus((s) => useUpdates.getState().setStatus(s));
  // Clipboard monitoring (desktop): a copied download link opens the Add dialog, like IDM.
  getPlatform().onClipboardUrl((url) => {
    // Already in the list (or copied from it with Copy address): nothing to offer.
    if (Object.values(useDownloads.getState().items).some((d) => d.url === url)) return;
    getPlatform().bringToFront();
    useUi.getState().queueAdd({ url });
  });
}

export const reloadState = loadState;
