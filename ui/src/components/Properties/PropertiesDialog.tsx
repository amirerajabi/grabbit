import { Settings2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api/client';
import { attempt } from '../../app/commands';
import { formatBytes, formatSpeed, parseRate } from '../../lib/format';
import { ACTIVE, useDownloads } from '../../store/downloads';
import { useUi } from '../../store/ui';
import { Dialog, Field } from '../common/Dialog';
import { FileIcon, StatusPill } from '../common/visuals';

/** Properties: refresh an expired address, rename, connections and a per-download speed limit. */
export function PropertiesDialog() {
  const id = useUi((s) => s.propertiesFor);
  const item = useDownloads((s) => (id ? s.items[id] : undefined));
  if (!id || !item) return null;
  return <PropertiesForm key={id} id={id} />;
}

function PropertiesForm({ id }: { id: string }) {
  const d = useDownloads((s) => s.items[id])!;
  const [url, setUrl] = useState(d.url);
  const [fileName, setFileName] = useState(d.fileName);
  const [connections, setConnections] = useState(d.connections);
  const [limit, setLimit] = useState(d.speedLimit ? String(Math.round(d.speedLimit / 1024)) : '');
  const [description, setDescription] = useState(d.description);
  const [referer, setReferer] = useState(d.referer ?? '');
  const running = ACTIVE.has(d.status);
  const done = d.status === 'completed';
  const limitBytes = limit.trim() ? parseRate(limit) : 0;

  const close = () => useUi.getState().set({ propertiesFor: null });
  const save = async () => {
    if (limitBytes === null) return;
    const ok = await attempt(
      () =>
        api.update(id, {
          url: url.trim() !== d.url ? url.trim() : undefined,
          fileName: !done && !running && fileName.trim() !== d.fileName ? fileName.trim() : undefined,
          connections,
          speedLimit: limitBytes,
          description,
          referer: referer.trim() || null,
        }),
      'Could not save',
    );
    if (ok) close();
  };

  return (
    <Dialog
      title="Properties"
      icon={<Settings2 size={18} className="text-accent" />}
      width={560}
      onClose={close}
      onSubmit={save}
      footer={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={limitBytes === null}>
            Save
          </button>
        </>
      }
    >
      <div className="form">
        <div className="props-head">
          <FileIcon category={d.category} size={22} />
          <div className="props-head-text">
            <strong className="ellipsis">{d.fileName}</strong>
            <span className="muted tabular">
              {formatBytes(d.received)} of {formatBytes(d.size)} · {d.resumable ? 'resumable' : 'not resumable'}
            </span>
          </div>
          <StatusPill status={d.status} />
        </div>
        <Field label="Address" hint={done ? undefined : 'Link expired? Paste a fresh one here: the downloaded part is kept.'}>
          <input className="input mono-sm" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
        </Field>
        <Field label="File name" hint={running ? 'Pause the download to rename it.' : done ? 'Rename the file on disk instead.' : undefined}>
          <input className="input" value={fileName} disabled={running || done} onChange={(e) => setFileName(e.target.value)} spellCheck={false} />
        </Field>
        <Field label="Save to">
          <input className="input" value={d.dir} readOnly />
        </Field>
        <div className="form-row">
          <Field label="Connections" hint="Takes effect on the next start">
            <input className="input" type="number" min={1} max={32} value={connections} disabled={done} onChange={(e) => setConnections(Math.max(1, Math.min(32, Number(e.target.value) || 1)))} />
          </Field>
          <Field label="Speed limit (KB/s)" hint={limitBytes === null ? 'Enter a number, e.g. 500 or 2 MB' : limitBytes ? formatSpeed(limitBytes) : 'No limit'}>
            <input className={`input${limitBytes === null ? ' invalid' : ''}`} value={limit} disabled={done} onChange={(e) => setLimit(e.target.value)} placeholder="No limit" />
          </Field>
        </div>
        <Field label="Referer">
          <input className="input mono-sm" value={referer} onChange={(e) => setReferer(e.target.value)} spellCheck={false} />
        </Field>
        <Field label="Description">
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
