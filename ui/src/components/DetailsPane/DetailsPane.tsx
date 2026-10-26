import { Copy, FolderOpen, Info, KeyRound, Pause, Play, RotateCcw, Settings2, SquareArrowOutUpRight, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { DownloadItem, HashAlgo, Segment } from '../../../../shared/protocol';
import { api } from '../../api/client';
import { attempt } from '../../app/commands';
import { isArchive } from '../../lib/archive';
import { ALGO_LABEL } from '../../lib/checksum';
import { formatBytes, formatDate, formatEta, formatSpeed, percent } from '../../lib/format';
import { ACTIVE, useDownloads } from '../../store/downloads';
import { useEngine } from '../../store/engine';
import { useUi } from '../../store/ui';
import { FileIcon, SegmentMap, StatusPill } from '../common/visuals';

/** The bottom pane: what IDM shows in its per-download progress window, for the selected download. */
export function DetailsPane() {
  const selected = useDownloads((s) => s.selected);
  const item = useDownloads((s) => (s.selected.length === 1 ? s.items[s.selected[0]] : undefined));
  const items = useDownloads((s) => s.items);

  return (
    <section className="details" aria-label="Download details">
      <div className="details-header">
        <span className="panel-title">Details</span>
        <button className="icon-btn xs" aria-label="Hide details" title="Hide details (Ctrl+J)" onClick={() => useUi.getState().setLayout({ detailsVisible: false })}>
          <X size={14} />
        </button>
      </div>
      {item ? (
        <ItemDetails item={item} />
      ) : selected.length > 1 ? (
        <MultiSummary items={selected.map((id) => items[id]).filter(Boolean)} />
      ) : (
        <div className="details-empty muted">
          <Info size={16} /> Select a download to see its connections and progress.
        </div>
      )}
    </section>
  );
}

function MultiSummary({ items }: { items: DownloadItem[] }) {
  const size = items.reduce((a, d) => a + (d.size ?? 0), 0);
  const received = items.reduce((a, d) => a + d.received, 0);
  const speed = items.reduce((a, d) => a + (ACTIVE.has(d.status) ? d.speed : 0), 0);
  return (
    <div className="details-body">
      <div className="details-title">
        <strong>{items.length} downloads selected</strong>
      </div>
      <dl className="kv">
        <Kv k="Total size" v={formatBytes(size)} />
        <Kv k="Downloaded" v={`${formatBytes(received)}${size ? ` (${((received / size) * 100).toFixed(1)}%)` : ''}`} />
        <Kv k="Transfer rate" v={formatSpeed(speed)} />
        <Kv k="Completed" v={String(items.filter((d) => d.status === 'completed').length)} />
      </dl>
    </div>
  );
}

function ItemDetails({ item: d }: { item: DownloadItem }) {
  const pct = percent(d.received, d.size);
  const running = ACTIVE.has(d.status);
  const canResume = d.status === 'stopped' || d.status === 'error' || d.status === 'queued';
  const queue = useEngine((s) => s.queues.find((q) => q.id === d.queueId));
  const avg = d.activeMs > 0 && d.status === 'completed' ? (d.size ?? d.received) / (d.activeMs / 1000) : 0;
  const active = d.segments.filter((s) => s.active).length;

  return (
    <div className="details-body">
      <div className="details-title">
        <FileIcon category={d.category} size={20} />
        <strong className="selectable" title={d.fileName}>
          {d.fileName}
        </strong>
        <StatusPill status={d.status} />
        <div className="flex-1" />
        {d.status === 'completed' ? (
          <>
            <button className="btn btn-xs" onClick={() => attempt(() => api.open(d.id, false), 'Could not open the file')}>
              <SquareArrowOutUpRight size={14} /> Open
            </button>
            <button className="btn btn-xs" onClick={() => attempt(() => api.open(d.id, true), 'Could not open the folder')}>
              <FolderOpen size={14} /> Folder
            </button>
          </>
        ) : running ? (
          <button className="btn btn-xs" onClick={() => attempt(() => api.bulk([d.id], 'pause'))}>
            <Pause size={14} /> Pause
          </button>
        ) : (
          canResume && (
            <button className="btn btn-xs btn-primary" onClick={() => attempt(() => api.bulk([d.id], 'start'))}>
              <Play size={14} /> {d.received > 0 ? 'Resume' : 'Start'}
            </button>
          )
        )}
        {d.status === 'error' && (
          <button className="btn btn-xs" onClick={() => attempt(() => api.bulk([d.id], 'redownload'))}>
            <RotateCcw size={14} /> Redownload
          </button>
        )}
        <button className="btn btn-xs" onClick={() => useUi.getState().set({ propertiesFor: d.id })}>
          <Settings2 size={14} /> Properties
        </button>
      </div>

      {d.status === 'error' && d.error && (
        <div className="details-error">
          <span>{d.error}</span>
          {/needs a username and password|refused the saved username/.test(d.error) && (
            <button className="btn btn-xs" onClick={() => useUi.getState().set({ loginPrompt: { downloadId: d.id, site: hostOf(d.finalUrl ?? d.url), realm: null, failed: /refused/.test(d.error ?? '') } })}>
              <KeyRound size={14} /> Enter login
            </button>
          )}
        </div>
      )}

      <div className="details-progress">
        <SegmentMap segments={d.segments} size={d.size} status={d.status} />
        <div className="details-progress-text tabular">
          <span>
            {formatBytes(d.received)} of {formatBytes(d.size)}
          </span>
          <span className="strong">{d.status === 'completed' ? '100%' : pct !== null ? `${pct.toFixed(2)}%` : ''}</span>
        </div>
      </div>

      <div className="details-grid">
        <dl className="kv">
          <Kv k="Address" v={<UrlValue url={d.url} />} />
          <Kv k="Save to" v={<span className="selectable mono-sm">{d.dir}</span>} />
          {d.video && <Kv k="Video" v={`${d.video.label}, downloaded with yt-dlp`} />}
          <Kv
            k="Status"
            v={d.status === 'error' ? 'Failed' : running ? (d.video ? 'Receiving data' : `Receiving data · ${active} of ${d.connections} connections`) : d.status === 'completed' ? `Completed ${formatDate(d.completedAt)}` : 'Not running'}
          />
          <Kv k="Transfer rate" v={running ? formatSpeed(d.speed) : avg ? `${formatSpeed(avg)} average` : '—'} />
          <Kv k="Time left" v={running ? formatEta(d.eta) : '—'} />
          {!d.video && (
            <Kv
              k="Resume capability"
              v={d.size === null && d.finalUrl === null ? 'Unknown until started' : d.resumable ? <span className="text-success">Yes</span> : <span className="text-warning">No — pausing restarts the file</span>}
            />
          )}
          {queue && <Kv k="Queue" v={queue.name} />}
          <Kv k="Added" v={formatDate(d.addedAt)} />
          {d.retries > 0 && <Kv k="Retries" v={String(d.retries)} />}
          {d.description && <Kv k="Description" v={d.description} />}
          <AfterDownload item={d} />
        </dl>
        {d.video ? <div className="conn-table muted">yt-dlp fetches the video and audio tracks over its own connections, and FFmpeg joins them.</div> : <ConnectionsTable segments={d.segments} running={running} />}
      </div>
    </div>
  );
}

const STEP_LABEL = { verifying: 'Checking the checksum…', scanning: 'Scanning for viruses…', extracting: 'Extracting…' } as const;

/** Checksum, virus scan and extraction results, plus "Calculate hash" for a finished file. */
function AfterDownload({ item: d }: { item: DownloadItem }) {
  const [algo, setAlgo] = useState<HashAlgo>('sha256');
  const c = d.checksum;
  const p = d.post;
  const busy = c?.state === 'computing';
  return (
    <>
      {p.step && <Kv k="Now" v={<span className="text-accent">{p.step === 'extracting' && p.message ? `${p.message}…` : STEP_LABEL[p.step]}</span>} />}
      {c && (
        <Kv
          k={`${ALGO_LABEL[c.algo]}`}
          v={
            <span className="hash-value">
              {c.state === 'ok' && <span className="text-success">Matches</span>}
              {c.state === 'mismatch' && <span className="text-danger">Does not match: the file is damaged or different</span>}
              {c.state === 'pending' && <span className="muted">Checked when the download finishes</span>}
              {c.state === 'computing' && <span className="muted">Calculating…</span>}
              {c.state === 'failed' && <span className="text-danger">Could not read the file</span>}
              {c.actual && <HashText hash={c.actual} />}
            </span>
          }
        />
      )}
      {d.status === 'completed' && !busy && (
        <Kv
          k="Checksum"
          v={
            <span className="hash-calc">
              <select className="input select xs" value={algo} onChange={(e) => setAlgo(e.target.value as HashAlgo)} aria-label="Hash algorithm">
                {(Object.keys(ALGO_LABEL) as HashAlgo[]).map((a) => (
                  <option key={a} value={a}>
                    {ALGO_LABEL[a]}
                  </option>
                ))}
              </select>
              <button className="btn btn-xs" onClick={() => attempt(() => api.checksum(d.id, algo), 'Could not calculate the hash')}>
                Calculate
              </button>
            </span>
          }
        />
      )}
      {p.scan && (
        <Kv
          k="Virus scan"
          v={p.scan === 'clean' ? <span className="text-success">No threats found</span> : p.scan === 'threat' ? <span className="text-danger">Threat found: {p.message}</span> : <span className="text-warning">Not scanned: {p.message}</span>}
        />
      )}
      {d.status === 'completed' && !p.step && (p.extract || isArchive(d.fileName)) && <ExtractRow item={d} />}
      {!p.scan && !p.extract && !p.step && p.message && <Kv k="Note" v={<span className="text-warning">{p.message}</span>} />}
    </>
  );
}

/** The extraction result, with a password field when the archive needs one and "Extract" when it hasn't run. */
function ExtractRow({ item: d }: { item: DownloadItem }) {
  const p = d.post;
  const [pw, setPw] = useState('');
  const run = (password?: string) => attempt(() => api.extract(d.id, password), 'Could not extract the archive');
  if (p.extract === 'done') {
    return (
      <Kv
        k="Extracted to"
        v={
          <span className="extract-done">
            <span className="selectable mono-sm">{p.extractedTo}</span>
            <button className="btn btn-xs" onClick={() => attempt(() => api.openFolder(p.extractedTo ?? undefined), 'Could not open the folder')}>
              <FolderOpen size={14} /> Open
            </button>
          </span>
        }
      />
    );
  }
  if (p.extract === 'password') {
    return (
      <Kv
        k="Extract"
        v={
          <span className="extract-pw">
            <span className="text-warning">{p.message ?? 'The archive is password-protected'}</span>
            <span className="input-with-btn">
              <input className="input xs" type="password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && pw && void run(pw)} placeholder="Password" autoComplete="off" aria-label="Archive password" />
              <button className="btn btn-xs" disabled={!pw} onClick={() => void run(pw)}>
                Extract
              </button>
            </span>
          </span>
        }
      />
    );
  }
  return (
    <Kv
      k="Extract"
      v={
        <span className="extract-done">
          {p.extract === 'failed' && <span className="text-danger">{p.message ?? 'Extraction failed'}</span>}
          <button className="btn btn-xs" onClick={() => void run()}>
            {p.extract === 'failed' ? 'Try again' : 'Extract now'}
          </button>
        </span>
      }
    />
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function HashText({ hash }: { hash: string }) {
  return (
    <span className="url-value">
      <span className="selectable mono-sm url-text" title={hash}>
        {hash}
      </span>
      <button className="icon-btn xs" title="Copy" aria-label="Copy hash" onClick={() => void navigator.clipboard.writeText(hash)}>
        <Copy size={12} />
      </button>
    </span>
  );
}

function ConnectionsTable({ segments, running }: { segments: Segment[]; running: boolean }) {
  if (segments.length === 0) return <div className="conn-table muted">No connections yet.</div>;
  return (
    <div className="conn-table" role="table" aria-label="Connections">
      <div className="conn-row conn-head" role="row">
        <span>#</span>
        <span>Range</span>
        <span className="right">Downloaded</span>
        <span>Info</span>
      </div>
      <div className="conn-body">
        {segments.map((s, i) => {
          const len = s.end >= 0 ? s.end - s.start + 1 : null;
          const done = len !== null && s.received >= len;
          return (
            <div key={`${s.start}-${i}`} className={`conn-row${s.active ? ' active' : ''}`} role="row">
              <span className="muted">{i + 1}</span>
              <span className="tabular">
                {formatBytes(s.start)} – {len !== null ? formatBytes(s.end + 1) : '?'}
              </span>
              <span className="right tabular">{formatBytes(s.received)}</span>
              <span className={done ? 'text-success' : s.active ? 'text-accent' : 'muted'}>{done ? 'Done' : s.active ? 'Receiving data…' : running ? 'Waiting' : 'Paused'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Kv({ k, v }: { k: string; v: ReactNode }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}

function UrlValue({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <span className="url-value">
      <span className="selectable mono-sm url-text" title={url}>
        {url}
      </span>
      <button
        className="icon-btn xs"
        title={copied ? 'Copied' : 'Copy address'}
        aria-label="Copy address"
        onClick={() => {
          void navigator.clipboard.writeText(url);
          setCopied(true);
        }}
      >
        <Copy size={12} />
      </button>
    </span>
  );
}
