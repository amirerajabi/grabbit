// Options → After download: archive extraction settings, saved archive passwords, and the helper programs (7-Zip,
// yt-dlp, FFmpeg) with their download state.
import { Download, LoaderCircle, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ToolInfo } from '../../../../shared/protocol';
import { api } from '../../api/client';
import { attempt } from '../../app/commands';
import { formatBytes } from '../../lib/format';
import { useEngine } from '../../store/engine';

const TOOL_PURPOSE: Record<ToolInfo['name'], string> = {
  '7zip': 'Extracts ZIP, 7z and RAR archives.',
  'yt-dlp': 'Finds and downloads videos from web pages.',
  ffmpeg: 'Joins separate video and audio tracks.',
};

function toolStatus(t: ToolInfo): string {
  if (t.state === 'downloading') return t.size ? `Downloading… ${Math.floor((t.received / t.size) * 100)}%` : `Downloading… ${formatBytes(t.received)}`;
  if (t.state === 'failed') return t.error ?? 'Download failed';
  if (t.source === 'system') return 'Installed on this computer';
  if (t.source === 'grabbit') return t.version ? `Downloaded, version ${t.version}` : 'Downloaded';
  return 'Downloaded the first time it is needed';
}

export function ToolsList() {
  const tools = useEngine((s) => s.tools);
  return (
    <div className="tools-list">
      {tools.map((t) => (
        <div key={t.name} className="tool-row">
          <div className="tool-text">
            <div className="tool-name">{t.label}</div>
            <div className="muted">{TOOL_PURPOSE[t.name]}</div>
            <div className={t.state === 'failed' ? 'text-danger' : t.state === 'ready' ? 'text-success' : 'muted'}>{toolStatus(t)}</div>
          </div>
          {t.state === 'downloading' ? (
            <LoaderCircle size={16} className="spin" aria-label="Downloading" />
          ) : t.state === 'missing' || t.state === 'failed' ? (
            <button className="btn btn-xs" onClick={() => attempt(() => api.installTool(t.name), `Could not download ${t.label}`)}>
              <Download size={14} /> Download now
            </button>
          ) : t.source === 'grabbit' ? (
            <button className="btn btn-xs" onClick={() => attempt(() => api.removeTool(t.name), `Could not remove ${t.label}`)}>
              <Trash2 size={14} /> Remove
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** How many archive passwords are saved (never the passwords themselves), with add and clear. */
export function ArchivePasswords() {
  const [count, setCount] = useState<number | null>(null);
  const [pw, setPw] = useState('');
  useEffect(() => {
    void api.archivePasswords().then((r) => setCount(r.count), () => setCount(null));
  }, []);
  const add = async () => {
    if (!pw) return;
    const r = await attempt(() => api.addArchivePassword(pw), 'Could not save the password');
    if (r) {
      setCount(r.count);
      setPw('');
    }
  };
  const clear = async () => {
    const r = await attempt(() => api.clearArchivePasswords(), 'Could not clear the passwords');
    if (r) setCount(0);
  };
  return (
    <div className="archive-pw">
      <div className="input-with-btn">
        <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} placeholder="Add a password" autoComplete="off" />
        <button className="btn" onClick={() => void add()} disabled={!pw}>
          Add
        </button>
      </div>
      <div className="archive-pw-count muted">
        {count === null ? '' : count === 0 ? 'No passwords saved.' : `${count} saved password${count === 1 ? '' : 's'}, stored encrypted.`}
        {!!count && (
          <button className="btn btn-xs btn-ghost" onClick={() => void clear()}>
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}
