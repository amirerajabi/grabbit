import type {
  AddDownloadRequest,
  BulkAction,
  DownloadItem,
  EngineState,
  GrabRequest,
  GrabResult,
  HashAlgo,
  ProbeResult,
  Queue,
  QueueSchedule,
  Settings,
  SiteLogin,
  ToolInfo,
  ToolName,
} from '../../../shared/protocol';
import { getPlatform } from '../platform';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { engineUrl, token } = getPlatform();
  let res: Response;
  try {
    res = await fetch(`${engineUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the Grabbit engine');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  state: () => call<EngineState>('GET', '/api/state'),
  probe: (url: string, referer?: string) => call<ProbeResult>('POST', '/api/probe', { url, referer }),
  add: (req: AddDownloadRequest) => call<DownloadItem>('POST', '/api/downloads', req),
  addBatch: (urls: string[], base: Omit<AddDownloadRequest, 'url'>) => call<DownloadItem[]>('POST', '/api/downloads/batch', { ...base, urls }),
  grab: (req: GrabRequest) => call<GrabResult>('POST', '/api/grab', req),
  stopGrab: (id: string) => call<{ ok: true }>('POST', `/api/grab/${id}/stop`),
  bulk: (ids: string[], action: BulkAction, arg?: string) => call<{ ok: true }>('POST', '/api/downloads/actions', { ids, action, arg }),
  pauseAll: () => call<{ ok: true }>('POST', '/api/downloads/pause-all'),
  removeCompleted: () => call<{ ok: true }>('POST', '/api/downloads/remove-completed'),
  update: (id: string, patch: Partial<Pick<DownloadItem, 'url' | 'fileName' | 'connections' | 'speedLimit' | 'description' | 'referer' | 'openWhenDone' | 'extract'>> & { checksum?: string | null }) =>
    call<DownloadItem>('PATCH', `/api/downloads/${id}`, patch),
  checksum: (id: string, algo: HashAlgo, expected?: string) => call<DownloadItem>('POST', `/api/downloads/${id}/checksum`, { algo, expected }),
  logins: () => call<SiteLogin[]>('GET', '/api/logins'),
  addLogin: (site: string, username: string, password: string) => call<SiteLogin>('POST', '/api/logins', { site, username, password }),
  removeLogin: (id: string) => call<{ ok: true }>('DELETE', `/api/logins/${id}`),
  archivePasswords: () => call<{ count: number }>('GET', '/api/archive-passwords'),
  addArchivePassword: (password: string) => call<{ count: number }>('POST', '/api/archive-passwords', { password }),
  clearArchivePasswords: () => call<{ count: number }>('DELETE', '/api/archive-passwords'),
  cancelWhenDone: () => call<{ ok: true }>('POST', '/api/when-done/cancel'),
  extract: (id: string, password?: string) => call<DownloadItem>('POST', `/api/downloads/${id}/extract`, { password }),
  installTool: (name: ToolName) => call<ToolInfo[]>('POST', `/api/tools/${name}/install`),
  removeTool: (name: ToolName) => call<ToolInfo[]>('DELETE', `/api/tools/${name}`),
  open: (id: string, reveal: boolean) => call<{ ok: true }>('POST', `/api/downloads/${id}/open`, { reveal }),
  openFolder: (dir?: string) => call<{ ok: true }>('POST', '/api/open-folder', { dir }),
  updateSettings: (patch: Partial<Settings>) => call<Settings>('PUT', '/api/settings', patch),
  createQueue: (name: string) => call<Queue>('POST', '/api/queues', { name }),
  updateQueue: (id: string, patch: Partial<Pick<Queue, 'name' | 'maxConcurrent'>> & { schedule?: Partial<QueueSchedule> }) =>
    call<Queue>('PATCH', `/api/queues/${id}`, patch),
  deleteQueue: (id: string) => call<{ ok: true }>('DELETE', `/api/queues/${id}`),
  startQueue: (id: string) => call<{ ok: true }>('POST', `/api/queues/${id}/start`),
  stopQueue: (id: string) => call<{ ok: true }>('POST', `/api/queues/${id}/stop`),
};
