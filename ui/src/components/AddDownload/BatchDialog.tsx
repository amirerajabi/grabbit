import { FileStack, LoaderCircle, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { GrabResult } from '../../../../shared/protocol';
import { api } from '../../api/client';
import { attempt } from '../../app/commands';
import { pluralize } from '../../lib/format';
import { useEngine } from '../../store/engine';
import { useUi } from '../../store/ui';
import { Dialog, Field } from '../common/Dialog';

type Mode = 'list' | 'pattern' | 'site';

const DEPTHS = [
  [0, 'This page only'],
  [1, 'Pages it links to'],
  [2, 'Two levels deep'],
  [3, 'Three levels deep'],
] as const;

/**
 * IDM's batch download: either a pasted list of addresses, or one address with a `*` wildcard expanded over a number
 * or letter range (img*.jpg, 1-50, zero-padded to 3 → img001.jpg … img050.jpg).
 */
export function expandPattern(pattern: string, from: string, to: string, width: number): string[] {
  if (!pattern.includes('*')) return [];
  const letters = /^[a-z]$/i.test(from) && /^[a-z]$/i.test(to);
  const out: string[] = [];
  if (letters) {
    let a = from.charCodeAt(0);
    let b = to.charCodeAt(0);
    if (a > b) [a, b] = [b, a];
    for (let c = a; c <= b; c++) out.push(pattern.replace('*', String.fromCharCode(c)));
    return out;
  }
  const a = Number(from);
  const b = Number(to);
  if (!Number.isInteger(a) || !Number.isInteger(b)) return [];
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  if (hi - lo > 4999) return [];
  for (let n = lo; n <= hi; n++) out.push(pattern.replace('*', String(n).padStart(width, '0')));
  return out;
}

function extensionOf(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').pop() ?? '';
    return last.includes('.') ? last.split('.').pop()!.toLowerCase() : '';
  } catch {
    return '';
  }
}

function hostOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).hostname : null;
  } catch {
    return null;
  }
}

export function BatchDialog() {
  const open = useUi((s) => s.batchOpen);
  if (!open) return null;
  return <BatchForm />;
}

function BatchForm() {
  const queues = useEngine((s) => s.queues);
  const captureExtensions = useEngine((s) => s.settings?.captureExtensions ?? []);
  // Links from the browser extension ("Download all links"), read once when the dialog opens.
  const [prefill] = useState(() => useUi.getState().batchPrefill);
  const [mode, setMode] = useState<Mode>('list');
  const [text, setText] = useState(() => prefill?.urls.join('\n') ?? '');
  const [filesOnly, setFilesOnly] = useState(!!prefill);
  const [pattern, setPattern] = useState('');
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('10');
  const [width, setWidth] = useState(1);
  const [queueId, setQueueId] = useState('main');
  const [busy, setBusy] = useState(false);
  // Site grabber
  const [siteUrl, setSiteUrl] = useState('');
  const [depth, setDepth] = useState(1);
  const [sameSite, setSameSite] = useState(true);
  const [types, setTypes] = useState(() => captureExtensions.join(' '));
  const [grabId, setGrabId] = useState<string | null>(null);
  const [grabbed, setGrabbed] = useState<GrabResult | null>(null);
  const progress = useUi((s) => (grabId && s.grabProgress?.id === grabId ? s.grabProgress : null));
  const validSite = /^https?:\/\/\S+$/i.test(siteUrl.trim());

  const urls = useMemo(() => {
    if (mode === 'pattern') return expandPattern(pattern.trim(), from.trim(), to.trim(), width);
    if (mode === 'site') return grabbed?.files ?? [];
    const found = [...new Set(text.match(/(?:https?|s?ftp):\/\/[^\s"'<>]+/gi) ?? [])];
    // A page's links are mostly navigation: keep the ones that point at a file type Grabbit captures.
    return filesOnly ? found.filter((u) => captureExtensions.includes(extensionOf(u))) : found;
  }, [mode, text, pattern, from, to, width, filesOnly, captureExtensions, grabbed]);

  const grab = async () => {
    const id = Math.random().toString(36).slice(2);
    setGrabId(id);
    setGrabbed(null);
    const extensions = types.split(/[\s,;]+/).map((t) => t.replace(/^\./, '').toLowerCase()).filter(Boolean);
    const r = await attempt(() => api.grab({ id, url: siteUrl.trim(), depth, sameSite, extensions }), 'Could not read the site');
    setGrabId(null);
    if (r) setGrabbed(r);
  };

  const close = () => {
    if (grabId) void api.stopGrab(grabId).catch(() => undefined);
    useUi.getState().set({ batchOpen: false, batchPrefill: null, grabProgress: null });
  };
  const submit = async (start: 'now' | 'queue') => {
    if (urls.length === 0) return;
    setBusy(true);
    const referer = mode === 'site' ? siteUrl.trim() : prefill?.referer;
    const r = await attempt(() => api.addBatch(urls, { start, queueId, referer, headers: mode === 'site' ? undefined : prefill?.headers }), 'Could not add the downloads');
    setBusy(false);
    if (r) {
      useUi.getState().toast({ level: 'success', text: `${pluralize(r.length, 'download')} added`, detail: start === 'now' ? 'The queue has started.' : 'They wait in the queue.' });
      close();
    }
  };

  return (
    <Dialog
      title="Batch download"
      icon={<FileStack size={18} className="text-accent" />}
      width={620}
      onClose={close}
      footer={
        <>
          <div className="flex-1 footer-note muted">{urls.length > 0 ? `${pluralize(urls.length, 'address', 'addresses')} found` : 'No addresses yet'}</div>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn" disabled={!urls.length || busy} onClick={() => submit('queue')}>
            Add to queue
          </button>
          <button className="btn btn-primary" disabled={!urls.length || busy} onClick={() => submit('now')}>
            {busy && <LoaderCircle size={16} className="spin" />} Start
          </button>
        </>
      }
    >
      <div className="form">
        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={mode === 'list'} className={mode === 'list' ? 'on' : ''} onClick={() => setMode('list')}>
            List of addresses
          </button>
          <button role="tab" aria-selected={mode === 'pattern'} className={mode === 'pattern' ? 'on' : ''} onClick={() => setMode('pattern')}>
            Address pattern
          </button>
          <button role="tab" aria-selected={mode === 'site'} className={mode === 'site' ? 'on' : ''} onClick={() => setMode('site')}>
            Website
          </button>
        </div>
        {mode === 'site' ? (
          <>
            <Field label="Start page" hint="Grabbit reads this page (and the pages it links to, if you choose) and lists the files it finds.">
              <div className="input-with-btn">
                <input
                  className="input mono-sm"
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && validSite && !grabId && void grab()}
                  placeholder="https://example.com/downloads/"
                  spellCheck={false}
                  autoFocus
                />
                {grabId ? (
                  <button className="btn" onClick={() => void api.stopGrab(grabId).catch(() => undefined)}>
                    Stop
                  </button>
                ) : (
                  <button className="btn" disabled={!validSite} onClick={() => void grab()}>
                    <Search size={16} /> Find files
                  </button>
                )}
              </div>
            </Field>
            <div className="form-row">
              <Field label="Follow links">
                <select className="input select" value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
                  {DEPTHS.map(([d, label]) => (
                    <option key={d} value={d}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="File types" hint="Extensions, separated by spaces.">
                <input className="input mono-sm" value={types} onChange={(e) => setTypes(e.target.value)} spellCheck={false} />
              </Field>
            </div>
            <label className="check">
              <input type="checkbox" checked={sameSite} onChange={(e) => setSameSite(e.target.checked)} disabled={depth === 0} />
              Stay on this site (files linked from other sites are still listed)
            </label>
            {(grabId || grabbed) && (
              <div className="grab-status muted" role="status">
                {grabId ? (
                  <>
                    <LoaderCircle size={14} className="spin" /> Reading pages… {progress ? `${pluralize(progress.pages, 'page')}, ${pluralize(progress.files, 'file')} so far` : ''}
                  </>
                ) : grabbed ? (
                  <>
                    {pluralize(grabbed.files.length, 'file')} on {pluralize(grabbed.pages, 'page')}
                    {grabbed.stopped ? ' (stopped)' : grabbed.truncated ? ` (stopped at the ${grabbed.pages}-page limit)` : ''}.
                  </>
                ) : null}
              </div>
            )}
          </>
        ) : mode === 'list' ? (
          <>
            <Field label="Addresses" hint={prefill ? `${prefill.urls.length} links from ${hostOf(prefill.referer) ?? 'your browser'}. Edit the list or filter it below.` : 'Paste links, one per line, or any text that contains them.'}>
              <textarea className="input textarea mono-sm" rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder={'https://example.com/part1.zip\nhttps://example.com/part2.zip'} spellCheck={false} autoFocus />
            </Field>
            <label className="check">
              <input type="checkbox" checked={filesOnly} onChange={(e) => setFilesOnly(e.target.checked)} />
              Only links to files (the types in Options → Browser &amp; clipboard)
            </label>
          </>
        ) : (
          <>
            <Field label="Address with a * wildcard">
              <input className="input mono-sm" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="https://example.com/photos/img*.jpg" spellCheck={false} autoFocus />
            </Field>
            <div className="form-row three">
              <Field label="From">
                <input className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="To">
                <input className="input" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
              <Field label="Wildcard length" hint="Zero-pads numbers: 3 → 001">
                <input className="input" type="number" min={1} max={10} value={width} onChange={(e) => setWidth(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />
              </Field>
            </div>
          </>
        )}
        <Field label="Queue">
          <select className="input select" value={queueId} onChange={(e) => setQueueId(e.target.value)}>
            {queues.map((q) => (
              <option key={q.id} value={q.id}>
                {q.name}
              </option>
            ))}
          </select>
        </Field>
        {urls.length > 0 && (
          <div className="batch-preview mono-sm" aria-label="Preview">
            {urls.slice(0, 6).map((u) => (
              <div key={u} className="ellipsis">
                {u}
              </div>
            ))}
            {urls.length > 6 && <div className="muted">…and {urls.length - 6} more</div>}
          </div>
        )}
      </div>
    </Dialog>
  );
}
