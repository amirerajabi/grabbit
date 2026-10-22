import { create } from 'zustand';
import type { CategoryId, DownloadItem, DownloadStatus, EngineEvent } from '../../../shared/protocol';

export type Filter =
  | { kind: 'all' }
  | { kind: 'category'; id: CategoryId }
  | { kind: 'unfinished' }
  | { kind: 'finished' }
  | { kind: 'queue'; id: string };

export type SortKey = 'name' | 'size' | 'progress' | 'status' | 'speed' | 'eta' | 'added';

interface DownloadsState {
  items: Record<string, DownloadItem>;
  totalSpeed: number;
  selected: string[];
  anchor: string | null;
  filter: Filter;
  query: string;
  sort: { key: SortKey; dir: 1 | -1 };
  loaded: boolean;
  setAll(items: DownloadItem[]): void;
  apply(e: EngineEvent): void;
  select(ids: string[], anchor?: string | null): void;
  setFilter(f: Filter): void;
  setQuery(q: string): void;
  setSort(key: SortKey): void;
}

export const ACTIVE: ReadonlySet<DownloadStatus> = new Set(['connecting', 'downloading', 'completing']);

export const useDownloads = create<DownloadsState>((set, get) => ({
  items: {},
  totalSpeed: 0,
  selected: [],
  anchor: null,
  filter: { kind: 'all' },
  query: '',
  sort: { key: 'added', dir: -1 },
  loaded: false,

  setAll(items) {
    const map: Record<string, DownloadItem> = {};
    for (const d of items) map[d.id] = d;
    set((s) => ({ items: map, loaded: true, selected: s.selected.filter((id) => map[id]) }));
  },

  apply(e) {
    switch (e.type) {
      case 'download.added':
      case 'download.updated': {
        const prev = get().items[e.item.id];
        // A status update can arrive between two progress ticks: keep the live speed while it is still running.
        const item = prev && ACTIVE.has(e.item.status) && e.item.speed === 0 ? { ...e.item, speed: prev.speed, eta: prev.eta } : e.item;
        set((s) => ({ items: { ...s.items, [item.id]: item } }));
        break;
      }
      case 'download.removed': {
        const gone = new Set(e.ids);
        set((s) => {
          const items = { ...s.items };
          for (const id of e.ids) delete items[id];
          return { items, selected: s.selected.filter((id) => !gone.has(id)) };
        });
        break;
      }
      case 'progress': {
        set((s) => {
          const items = { ...s.items };
          for (const p of e.entries) {
            const d = items[p.id];
            if (d) items[p.id] = { ...d, status: p.status, received: p.received, size: p.size, speed: p.speed, eta: p.eta, segments: p.segments };
          }
          return { items, totalSpeed: e.totalSpeed };
        });
        break;
      }
      default:
        break;
    }
  },

  select(ids, anchor) {
    set({ selected: ids, anchor: anchor === undefined ? ids[ids.length - 1] ?? null : anchor });
  },
  setFilter(filter) {
    set({ filter, selected: [] });
  },
  setQuery(query) {
    set({ query });
  },
  setSort(key) {
    const cur = get().sort;
    set({ sort: { key, dir: cur.key === key ? (cur.dir === 1 ? -1 : 1) : key === 'name' ? 1 : -1 } });
  },
}));

export function matchesFilter(d: DownloadItem, f: Filter): boolean {
  switch (f.kind) {
    case 'all':
      return true;
    case 'category':
      return d.category === f.id;
    case 'unfinished':
      return d.status !== 'completed';
    case 'finished':
      return d.status === 'completed';
    case 'queue':
      return d.queueId === f.id && d.status !== 'completed';
  }
}

const STATUS_RANK: Record<DownloadStatus, number> = { downloading: 0, connecting: 1, completing: 2, queued: 3, stopped: 4, error: 5, completed: 6 };

export function sortItems(list: DownloadItem[], key: SortKey, dir: 1 | -1, queueOrder: boolean): DownloadItem[] {
  if (queueOrder) return [...list].sort((a, b) => a.queueOrder - b.queueOrder);
  const val = (d: DownloadItem): number | string => {
    switch (key) {
      case 'name':
        return d.fileName.toLowerCase();
      case 'size':
        return d.size ?? -1;
      case 'progress':
        return d.size ? d.received / d.size : d.status === 'completed' ? 1 : 0;
      case 'status':
        return STATUS_RANK[d.status];
      case 'speed':
        return d.speed;
      case 'eta':
        return d.eta ?? Number.MAX_SAFE_INTEGER;
      case 'added':
        return d.addedAt;
    }
  };
  return [...list].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    // Ties (a batch is added within one millisecond) keep the order they were added in.
    return (x < y ? -1 : x > y ? 1 : 0) * dir || b.addedAt - a.addedAt || a.queueOrder - b.queueOrder || a.fileName.localeCompare(b.fileName);
  });
}

/** The rows the list shows right now, in order (filter, quick search, sort). */
export function visibleItems(s: Pick<DownloadsState, 'items' | 'filter' | 'query' | 'sort'>): DownloadItem[] {
  const q = s.query.trim().toLowerCase();
  const list = Object.values(s.items).filter((d) => matchesFilter(d, s.filter) && (!q || d.fileName.toLowerCase().includes(q) || d.url.toLowerCase().includes(q)));
  return sortItems(list, s.sort.key, s.sort.dir, s.filter.kind === 'queue');
}
