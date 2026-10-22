import { FileStack, LoaderCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '../../api/client';
import { attempt } from '../../app/commands';
import { pluralize } from '../../lib/format';
import { useEngine } from '../../store/engine';
import { useUi } from '../../store/ui';
import { Dialog, Field } from '../common/Dialog';

type Mode = 'list' | 'pattern';

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

export function BatchDialog() {
  const open = useUi((s) => s.batchOpen);
  if (!open) return null;
  return <BatchForm />;
}

function BatchForm() {
  const queues = useEngine((s) => s.queues);
  const [mode, setMode] = useState<Mode>('list');
  const [text, setText] = useState('');
  const [pattern, setPattern] = useState('');
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('10');
  const [width, setWidth] = useState(1);
  const [queueId, setQueueId] = useState('main');
  const [busy, setBusy] = useState(false);

  const urls = useMemo(() => {
    if (mode === 'pattern') return expandPattern(pattern.trim(), from.trim(), to.trim(), width);
    const found = text.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
    return [...new Set(found)];
  }, [mode, text, pattern, from, to, width]);

  const close = () => useUi.getState().set({ batchOpen: false });
  const submit = async (start: 'now' | 'queue') => {
    if (urls.length === 0) return;
    setBusy(true);
    const r = await attempt(() => api.addBatch(urls, { start, queueId }), 'Could not add the downloads');
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
        </div>
        {mode === 'list' ? (
          <Field label="Addresses" hint="Paste links, one per line, or any text that contains them.">
            <textarea className="input textarea mono-sm" rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder={'https://example.com/part1.zip\nhttps://example.com/part2.zip'} spellCheck={false} autoFocus />
          </Field>
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
