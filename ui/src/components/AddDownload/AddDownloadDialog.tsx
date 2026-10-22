import { AlertTriangle, ChevronDown, ChevronRight, CircleCheck, Download, FolderOpen, LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CategoryId, ProbeResult } from '../../../../shared/protocol';
import { api } from '../../api/client';
import { attempt } from '../../app/commands';
import { formatBytes } from '../../lib/format';
import { categoryDir, fileNameFromUrl, guessCategory } from '../../lib/paths';
import { getPlatform } from '../../platform';
import { useDownloads } from '../../store/downloads';
import { useEngine } from '../../store/engine';
import { useUi } from '../../store/ui';
import { Dialog, Field } from '../common/Dialog';
import { showMenuBelow } from '../common/Menu';
import { CategoryIcon } from '../common/visuals';

/** "Download file info": paste an address, Grabbit asks the server for name, size and resume support. */
export function AddDownloadDialog() {
  const init = useUi((s) => s.addDialog);
  if (!init) return null;
  return <AddForm key={init.captureId ?? init.url} />;
}

function AddForm() {
  const init = useUi((s) => s.addDialog)!;
  const settings = useEngine((s) => s.settings);
  const categories = useEngine((s) => s.categories);
  const queues = useEngine((s) => s.queues);
  const items = useDownloads((s) => s.items);

  const [url, setUrl] = useState(init.url);
  const [referer, setReferer] = useState(init.referer ?? '');
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [fileName, setFileName] = useState(init.fileName ?? '');
  const [nameTouched, setNameTouched] = useState(!!init.fileName);
  const [category, setCategory] = useState<CategoryId>('general');
  const [catTouched, setCatTouched] = useState(false);
  const [dir, setDir] = useState('');
  const [dirTouched, setDirTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [connections, setConnections] = useState(settings?.maxConnections ?? 8);
  const [busy, setBusy] = useState(false);

  const validUrl = /^https?:\/\/\S+$/i.test(url.trim());
  const duplicate = useMemo(() => Object.values(items).find((d) => d.url === url.trim()), [items, url]);

  // Ask the server about the address shortly after the user stops typing.
  useEffect(() => {
    setProbe(null);
    setProbeError(null);
    if (!validUrl) return;
    const guess = fileNameFromUrl(url.trim());
    if (!nameTouched && guess) setFileName(guess);
    let cancelled = false;
    const t = setTimeout(async () => {
      setProbing(true);
      try {
        const p = await api.probe(url.trim(), referer.trim() || undefined);
        if (cancelled) return;
        setProbe(p);
        if (!nameTouched) setFileName(init.fileName ?? p.fileName);
      } catch (e) {
        if (!cancelled) setProbeError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setProbing(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
      setProbing(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, referer]);

  // Category and folder follow the file name until the user picks them.
  useEffect(() => {
    if (catTouched) return;
    const c = probe?.category && probe.fileName === fileName ? probe.category : guessCategory(fileName);
    setCategory(c);
  }, [fileName, probe, catTouched]);
  useEffect(() => {
    if (!dirTouched && settings) setDir(categoryDir(settings, category));
  }, [category, settings, dirTouched]);

  const close = () => useUi.getState().closeAdd();

  const submit = async (start: 'now' | 'queue', queueId?: string) => {
    if (!validUrl || busy) return;
    setBusy(true);
    const added = await attempt(
      () =>
        api.add({
          url: url.trim(),
          fileName: fileName.trim() || undefined,
          dir: dir.trim() || undefined,
          category,
          start,
          queueId,
          connections,
          referer: referer.trim() || undefined,
          headers: init.headers,
          description: description.trim() || undefined,
          probe: probe ? { finalUrl: probe.finalUrl, size: probe.size, resumable: probe.resumable, mime: probe.mime } : undefined,
        }),
      'Could not add the download',
    );
    setBusy(false);
    if (added) {
      useDownloads.getState().select([added.id]);
      close();
    }
  };

  const browse = async () => {
    const picked = await getPlatform().chooseFolder(dir);
    if (picked) {
      setDir(picked);
      setDirTouched(true);
    }
  };

  return (
    <Dialog
      title="Add download"
      icon={<Download size={18} className="text-accent" />}
      width={600}
      onClose={close}
      onSubmit={() => submit('now')}
      footer={
        <>
          <div className="flex-1 footer-note muted">{init.captureId ? 'Captured from your browser' : ''}</div>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <div className="split-btn">
            <button className="btn" disabled={!validUrl || busy} onClick={() => submit('queue', 'main')} title="Add to the main queue">
              Download later
            </button>
            <button
              className="btn split-caret"
              disabled={!validUrl || busy}
              aria-label="Choose a queue"
              onClick={(e) => showMenuBelow(e.currentTarget, queues.map((q) => ({ label: `Add to ${q.name}`, run: () => submit('queue', q.id) })))}
            >
              <ChevronDown size={14} />
            </button>
          </div>
          <button className="btn btn-primary" disabled={!validUrl || busy} onClick={() => submit('now')}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />} Start download
          </button>
        </>
      }
    >
      <div className="form">
        <Field label="Address">
          <input className={`input${url && !validUrl ? ' invalid' : ''}`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/file.zip" spellCheck={false} autoFocus />
        </Field>

        <div className={`probe-strip${probeError ? ' error' : ''}`} aria-live="polite">
          {!validUrl ? (
            <span className="muted">Paste an http:// or https:// link.</span>
          ) : probing ? (
            <span className="muted">
              <LoaderCircle size={14} className="spin" /> Checking the address…
            </span>
          ) : probeError ? (
            <span>
              <AlertTriangle size={14} /> {probeError}. You can still add it; Grabbit will try again when it starts.
            </span>
          ) : probe ? (
            <>
              <span>
                <CircleCheck size={14} className="text-success" /> <strong className="tabular">{probe.size !== null ? formatBytes(probe.size) : 'Unknown size'}</strong>
              </span>
              <span className="muted">{probe.mime ?? 'unknown type'}</span>
              <span className={probe.resumable ? 'text-success' : 'text-warning'}>{probe.resumable ? 'Resumable · multi-connection' : 'Not resumable · single connection'}</span>
            </>
          ) : null}
        </div>

        {duplicate && (
          <div className="notice warning">
            <AlertTriangle size={14} /> This address is already in the list ({duplicate.fileName}, {duplicate.status === 'completed' ? 'complete' : duplicate.status}). Adding it again saves a second copy.
          </div>
        )}

        <Field label="File name">
          <input
            className="input"
            value={fileName}
            onChange={(e) => {
              setFileName(e.target.value);
              setNameTouched(true);
            }}
            placeholder="Taken from the server"
            spellCheck={false}
          />
        </Field>

        <div className="form-row">
          <Field label="Category">
            <div className="select-wrap">
              <CategoryIcon category={category} />
              <select
                className="input select"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value as CategoryId);
                  setCatTouched(true);
                }}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </Field>
          <Field label="Save to">
            <div className="input-with-btn">
              <input
                className="input"
                value={dir}
                onChange={(e) => {
                  setDir(e.target.value);
                  setDirTouched(true);
                }}
                spellCheck={false}
              />
              {getPlatform().kind === 'electron' && (
                <button className="btn" onClick={browse} title="Choose a folder">
                  <FolderOpen size={16} />
                </button>
              )}
            </div>
          </Field>
        </div>

        <Field label="Description">
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional note" />
        </Field>

        <button className="link-btn disclosure" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
          {advanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Advanced
        </button>
        {advanced && (
          <div className="form-row">
            <Field label="Connections" hint="Parallel parts for this file">
              <input className="input" type="number" min={1} max={32} value={connections} onChange={(e) => setConnections(Math.max(1, Math.min(32, Number(e.target.value) || 1)))} />
            </Field>
            <Field label="Referer" hint="Some servers only serve the file to their own pages">
              <input className="input" value={referer} onChange={(e) => setReferer(e.target.value)} placeholder="https://example.com/page" spellCheck={false} />
            </Field>
          </div>
        )}
      </div>
    </Dialog>
  );
}
