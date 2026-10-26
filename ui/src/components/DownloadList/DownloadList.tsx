import { AlertCircle, ArrowDown, ArrowUp, ClipboardPaste, Download, Globe } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DownloadItem } from '../../../../shared/protocol';
import { runCommand } from '../../app/commands';
import { displayShortcut } from '../../app/keys';
import { formatBytes, formatDate, formatEta, formatSpeed, percent } from '../../lib/format';
import { useDownloads, visibleItems, type SortKey } from '../../store/downloads';
import { useMenu } from '../common/Menu';
import { FileIcon, ProgressBar, statusLabel } from '../common/visuals';
import { listMenu } from './contextMenu';

const COLUMNS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'name', label: 'File name' },
  { key: 'size', label: 'Size', align: 'right' },
  { key: 'progress', label: 'Progress' },
  { key: 'status', label: 'Status' },
  { key: 'speed', label: 'Speed', align: 'right' },
  { key: 'eta', label: 'Time left', align: 'right' },
  { key: 'added', label: 'Added' },
];

const ROW_H = 30;
const OVERSCAN = 8;

/** The downloads table: virtualized rows, sortable columns, multi-select, keyboard navigation and context menu. */
export function DownloadList() {
  const items = useDownloads((s) => s.items);
  const filter = useDownloads((s) => s.filter);
  const query = useDownloads((s) => s.query);
  const sort = useDownloads((s) => s.sort);
  const selected = useDownloads((s) => s.selected);
  const loaded = useDownloads((s) => s.loaded);
  const rows = useMemo(() => visibleItems({ items, filter, query, sort }), [items, filter, query, sort]);
  const selSet = useMemo(() => new Set(selected), [selected]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, height: 600 });

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScroll({ top: el.scrollTop, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const indexOf = (id: string | null) => (id ? rows.findIndex((d) => d.id === id) : -1);

  const ensureVisible = (i: number) => {
    const el = bodyRef.current;
    if (!el || i < 0) return;
    const top = i * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
  };

  // Selecting from elsewhere (palette, a toast) scrolls the row into view.
  const lastSel = selected[selected.length - 1] ?? null;
  useEffect(() => {
    if (lastSel) ensureVisible(indexOf(lastSel));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSel]);

  const onRowMouseDown = (e: React.MouseEvent, d: DownloadItem) => {
    const s = useDownloads.getState();
    if (e.button === 2) {
      if (!selSet.has(d.id)) s.select([d.id]);
      return;
    }
    if (e.shiftKey && s.anchor) {
      const a = indexOf(s.anchor);
      const b = indexOf(d.id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const range = rows.slice(lo, hi + 1).map((x) => x.id);
        s.select(e.ctrlKey || e.metaKey ? [...new Set([...s.selected, ...range])] : range, s.anchor);
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      s.select(selSet.has(d.id) ? s.selected.filter((x) => x !== d.id) : [...s.selected, d.id], d.id);
      return;
    }
    s.select([d.id], d.id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (rows.length === 0) return;
    const s = useDownloads.getState();
    const page = Math.max(1, Math.floor((bodyRef.current?.clientHeight ?? 300) / ROW_H) - 1);
    const cur = indexOf(lastSel);
    let next = -1;
    if (e.key === 'ArrowDown') next = Math.min(rows.length - 1, cur + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, cur < 0 ? 0 : cur - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = rows.length - 1;
    else if (e.key === 'PageDown') next = Math.min(rows.length - 1, cur + page);
    else if (e.key === 'PageUp') next = Math.max(0, cur - page);
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      const row = bodyRef.current?.querySelector('.dl-row.selected') as HTMLElement | null;
      const r = (row ?? bodyRef.current!).getBoundingClientRect();
      useMenu.getState().show(r.left + 40, r.top + ROW_H, listMenu());
      return;
    }
    if (next < 0) return;
    e.preventDefault();
    const id = rows[next].id;
    if (e.shiftKey && s.anchor) {
      const a = indexOf(s.anchor);
      const [lo, hi] = a < next ? [a, next] : [next, a];
      s.select([...rows.slice(lo, hi + 1).map((x) => x.id).filter((x) => x !== id), id], s.anchor);
    } else {
      s.select([id], id);
    }
    ensureVisible(next);
  };

  const first = Math.max(0, Math.floor(scroll.top / ROW_H) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scroll.top + scroll.height) / ROW_H) + OVERSCAN);

  return (
    <div className="dl-table">
      <div className="dl-header dl-grid" role="row">
        {COLUMNS.map((c) => {
          const active = filter.kind !== 'queue' && sort.key === c.key;
          return (
            <button
              key={c.key}
              role="columnheader"
              aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
              className={`dl-th${c.align === 'right' ? ' right' : ''}${active ? ' sorted' : ''}`}
              onClick={() => useDownloads.getState().setSort(c.key)}
              title={filter.kind === 'queue' ? 'Queues are shown in queue order' : `Sort by ${c.label.toLowerCase()}`}
            >
              <span>{c.label}</span>
              {active && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
            </button>
          );
        })}
      </div>
      <div
        ref={bodyRef}
        className="dl-list"
        role="grid"
        aria-label="Downloads"
        aria-multiselectable="true"
        aria-rowcount={rows.length}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) useDownloads.getState().select([]);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          useMenu.getState().show(e.clientX, e.clientY, listMenu());
        }}
      >
        {rows.length === 0 ? (
          loaded && <EmptyList filtered={Object.keys(items).length > 0} />
        ) : (
          <div className="dl-rows" style={{ height: rows.length * ROW_H }}>
            {rows.slice(first, last).map((d, i) => (
              <Row key={d.id} item={d} index={first + i} selected={selSet.has(d.id)} onMouseDown={onRowMouseDown} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const Row = memo(function Row({ item: d, index, selected, onMouseDown }: { item: DownloadItem; index: number; selected: boolean; onMouseDown: (e: React.MouseEvent, d: DownloadItem) => void }) {
  const pct = percent(d.received, d.size);
  const running = d.status === 'downloading' || d.status === 'connecting';
  return (
    <div
      role="row"
      aria-selected={selected}
      aria-rowindex={index + 1}
      className={`dl-row dl-grid${selected ? ' selected' : ''}${index % 2 ? ' alt' : ''}`}
      style={{ transform: `translateY(${index * ROW_H}px)` }}
      onMouseDown={(e) => onMouseDown(e, d)}
      onDoubleClick={() => runCommand(d.status === 'completed' ? 'download.open' : 'download.properties')}
      title={d.error ?? undefined}
    >
      <div className="dl-cell dl-name" role="gridcell">
        <FileIcon category={d.category} />
        <span className="dl-name-text">{d.fileName}</span>
        {d.queueId && d.status === 'queued' && <span className="pill pill-muted">Q</span>}
      </div>
      <div className="dl-cell right tabular" role="gridcell">
        {formatBytes(d.size)}
      </div>
      <div className="dl-cell dl-progress" role="gridcell">
        <ProgressBar value={d.status === 'completed' ? 100 : pct} status={d.status} />
        <span className="dl-pct tabular">{d.status === 'completed' ? '100%' : pct !== null ? `${pct.toFixed(pct < 10 ? 1 : 0)}%` : d.received ? formatBytes(d.received) : ''}</span>
      </div>
      <StatusCell item={d} />
      <div className="dl-cell right tabular" role="gridcell">
        {running ? formatSpeed(d.speed) : ''}
      </div>
      <div className="dl-cell right tabular" role="gridcell">
        {running ? formatEta(d.eta) : ''}
      </div>
      <div className="dl-cell muted tabular" role="gridcell">
        {formatDate(d.status === 'completed' ? d.completedAt : d.addedAt)}
      </div>
    </div>
  );
});

const POST_STEP = { verifying: 'Verifying…', scanning: 'Scanning…', extracting: 'Extracting…' } as const;

/** Status, with what happened after the download for finished files (a bad checksum or a threat is an error). */
function StatusCell({ item: d }: { item: DownloadItem }) {
  let label = statusLabel(d.status);
  let tone: string = d.status;
  let warn = d.status === 'error';
  if (d.status === 'completed') {
    if (d.post.step) {
      label = POST_STEP[d.post.step];
      tone = 'completing';
    } else if (d.checksum?.state === 'mismatch') {
      label = 'Bad checksum';
      tone = 'error';
      warn = true;
    } else if (d.post.scan === 'threat') {
      label = 'Threat found';
      tone = 'error';
      warn = true;
    } else if (d.post.extract === 'done') {
      label = 'Extracted';
    } else if (d.post.extract === 'password' || d.post.extract === 'failed') {
      label = d.post.extract === 'password' ? 'Needs password' : 'Extract failed';
      tone = 'queued';
    }
  }
  return (
    <div className={`dl-cell dl-status st-${tone}`} role="gridcell">
      {warn && <AlertCircle size={14} />}
      <span>{label}</span>
    </div>
  );
}

function EmptyList({ filtered }: { filtered: boolean }) {
  if (filtered) {
    return (
      <div className="empty-state small">
        <p className="muted">No downloads here.</p>
      </div>
    );
  }
  return (
    <div className="empty-state">
      <div className="empty-illustration" aria-hidden="true">
        <Download size={40} strokeWidth={1.25} />
      </div>
      <h2>No downloads yet</h2>
      <p className="muted">Paste a link to start. Grabbit splits each file into several parts and fetches them in parallel, so big downloads finish sooner and resume after a pause.</p>
      <div className="empty-actions">
        <button className="btn btn-primary" onClick={() => runCommand('download.add')}>
          <Download size={16} /> Add URL
          <span className="btn-kbd">{displayShortcut('Mod+N')}</span>
        </button>
        <button className="btn" onClick={() => runCommand('download.batch')}>
          Batch download
        </button>
      </div>
      <ul className="empty-tips muted">
        <li>
          <ClipboardPaste size={14} /> Copy a download link: the Add dialog opens by itself (desktop app).
        </li>
        <li>
          <Globe size={14} /> Install the browser extension to send links and downloads straight to Grabbit.
        </li>
      </ul>
    </div>
  );
}
