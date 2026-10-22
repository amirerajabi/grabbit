import { File, FileArchive, FileAudio, FileCode2, FileText, FileVideo } from 'lucide-react';
import type { CategoryId, DownloadStatus, Segment } from '../../../../shared/protocol';
import { displayShortcut, shortcutParts } from '../../app/keys';

/** The Grabbit mark: a navy tile, two rows and a lit download arrow (same artwork as the app icon). */
export function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <svg className="brand-mark-svg" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="bm-tile" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--brand-mark-tile-top)" />
          <stop offset="1" stopColor="var(--brand-mark-tile-bottom)" />
        </linearGradient>
        <linearGradient id="bm-lit" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--brand-mark-lit-start)" />
          <stop offset="1" stopColor="var(--brand-mark-lit-end)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7" fill="url(#bm-tile)" />
      <rect x="7" y="8" width="18" height="3" rx="1.5" fill="var(--brand-mark-row)" />
      <rect x="7" y="13" width="12" height="3" rx="1.5" fill="url(#bm-lit)" />
      <path d="M16 15v8m-4-4 4 4 4-4" fill="none" stroke="url(#bm-lit)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const CAT_ICON: Record<CategoryId, typeof File> = {
  general: File,
  compressed: FileArchive,
  documents: FileText,
  music: FileAudio,
  programs: FileCode2,
  video: FileVideo,
};

export function FileIcon({ category, size = 16 }: { category: CategoryId; size?: number }) {
  const Icon = CAT_ICON[category];
  return (
    <span className={`file-icon cat-${category}`}>
      <Icon size={size} />
    </span>
  );
}

export function CategoryIcon({ category, size = 16 }: { category: CategoryId; size?: number }) {
  const Icon = CAT_ICON[category];
  return <Icon size={size} className={`cat-${category}`} />;
}

function progressTone(status: DownloadStatus): string {
  if (status === 'completed') return 'done';
  if (status === 'error') return 'error';
  if (status === 'stopped' || status === 'queued') return 'paused';
  return 'active';
}

/** Thin progress bar; `value` null = indeterminate (size unknown while running). */
export function ProgressBar({ value, status, height = 6 }: { value: number | null; status: DownloadStatus; height?: number }) {
  const tone = progressTone(status);
  return (
    <div className={`progress tone-${tone}${value === null && tone === 'active' ? ' indeterminate' : ''}`} style={{ height }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined}>
      <div className="progress-fill" style={{ width: `${value ?? (tone === 'done' ? 100 : 0)}%` }} />
    </div>
  );
}

/**
 * IDM's connection map: the file as one long bar, each range drawn at its offset, its received part filled, the
 * ranges a connection is filling right now highlighted.
 */
export function SegmentMap({ segments, size, status }: { segments: Segment[]; size: number | null; status: DownloadStatus }) {
  if (!size || segments.length === 0) {
    return <ProgressBar value={status === 'completed' ? 100 : null} status={status} height={18} />;
  }
  return (
    <div className={`segment-map tone-${progressTone(status)}`} aria-hidden="true">
      {segments.map((s, i) => {
        const len = s.end - s.start + 1;
        return (
          <div key={i} className={`segment${s.active ? ' active' : ''}`} style={{ left: `${(s.start / size) * 100}%`, width: `${(len / size) * 100}%` }}>
            <div className="segment-fill" style={{ width: `${Math.min(100, (s.received / len) * 100)}%` }} />
          </div>
        );
      })}
    </div>
  );
}

export function Kbd({ shortcut }: { shortcut?: string }) {
  if (!shortcut) return null;
  return (
    <span className="kbd-group" aria-label={displayShortcut(shortcut)}>
      {shortcutParts(shortcut).map((k, i) => (
        <kbd key={i}>{k}</kbd>
      ))}
    </span>
  );
}

const STATUS_LABEL: Record<DownloadStatus, string> = {
  stopped: 'Stopped',
  queued: 'Queued',
  connecting: 'Connecting…',
  downloading: 'Downloading',
  completing: 'Finishing…',
  completed: 'Complete',
  error: 'Error',
};

export function statusLabel(status: DownloadStatus): string {
  return STATUS_LABEL[status];
}

export function StatusPill({ status }: { status: DownloadStatus }) {
  return <span className={`status-pill st-${status}`}>{STATUS_LABEL[status]}</span>;
}
