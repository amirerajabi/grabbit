import { ArrowDown, ArrowUp, CalendarClock, ListOrdered, Pause, Play, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Queue } from '../../../../shared/protocol';
import { api } from '../../api/client';
import { attempt } from '../../app/commands';
import { formatBytes } from '../../lib/format';
import { useDownloads } from '../../store/downloads';
import { useEngine } from '../../store/engine';
import { useUi } from '../../store/ui';
import { Dialog, Field } from '../common/Dialog';
import { FileIcon, StatusPill } from '../common/visuals';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** IDM's Scheduler: queues on the left; name, concurrency, start/stop times, days and the queue's files on the right. */
export function QueuesDialog() {
  const open = useUi((s) => s.queuesOpen);
  if (!open) return null;
  return <QueuesForm initial={open} />;
}

function QueuesForm({ initial }: { initial: string }) {
  const queues = useEngine((s) => s.queues);
  const [current, setCurrent] = useState(initial);
  const q = queues.find((x) => x.id === current) ?? queues[0];
  const close = () => useUi.getState().set({ queuesOpen: null });

  const add = async () => {
    const created = await attempt(() => api.createQueue(`Queue ${queues.length + 1}`));
    if (created) setCurrent(created.id);
  };

  return (
    <Dialog
      title="Scheduler"
      icon={<CalendarClock size={18} className="text-accent" />}
      width={820}
      className="queues-dialog"
      onClose={close}
      footer={
        <button className="btn btn-primary" onClick={close}>
          Done
        </button>
      }
    >
      <div className="queues-layout">
        <nav className="queues-nav" aria-label="Queues">
          {queues.map((x) => (
            <button key={x.id} className={`nav-item${x.id === q?.id ? ' active' : ''}`} onClick={() => setCurrent(x.id)}>
              <ListOrdered size={16} className={x.running ? 'text-success' : ''} />
              <span className="ellipsis">{x.name}</span>
              {x.schedule.enabled && <CalendarClock size={12} className="muted" />}
            </button>
          ))}
          <button className="nav-item add" onClick={add}>
            <Plus size={16} /> New queue
          </button>
        </nav>
        {q && <QueueEditor key={q.id} queue={q} onDeleted={() => setCurrent('main')} />}
      </div>
    </Dialog>
  );
}

function QueueEditor({ queue: q, onDeleted }: { queue: Queue; onDeleted: () => void }) {
  const items = useDownloads((s) => s.items);
  const [name, setName] = useState(q.name);
  useEffect(() => setName(q.name), [q.name]);
  const files = useMemo(() => Object.values(items).filter((d) => d.queueId === q.id && d.status !== 'completed').sort((a, b) => a.queueOrder - b.queueOrder), [items, q.id]);
  const s = q.schedule;
  const update = (patch: Parameters<typeof api.updateQueue>[1]) => attempt(() => api.updateQueue(q.id, patch), 'Could not save the queue');

  return (
    <div className="queue-editor">
      <div className="queue-head">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== q.name && update({ name })} />
        </Field>
        <Field label="Files at once">
          <input className="input narrow" type="number" min={1} max={20} value={q.maxConcurrent} onChange={(e) => update({ maxConcurrent: Number(e.target.value) || 1 })} />
        </Field>
        <div className="queue-head-actions">
          {q.running ? (
            <button className="btn" onClick={() => attempt(() => api.stopQueue(q.id))}>
              <Pause size={16} /> Stop
            </button>
          ) : (
            <button className="btn btn-run" onClick={() => attempt(() => api.startQueue(q.id))}>
              <Play size={16} /> Start now
            </button>
          )}
          {!q.builtIn && (
            <button
              className="icon-btn danger"
              title="Delete queue"
              aria-label="Delete queue"
              onClick={async () => {
                const r = await useUi.getState().askConfirm({ title: 'Delete queue', message: `Delete "${q.name}"? Its downloads move to the main queue.`, confirmLabel: 'Delete', danger: true });
                if (r.ok && (await attempt(() => api.deleteQueue(q.id)))) onDeleted();
              }}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      <fieldset className="schedule">
        <legend>
          <label className="check">
            <input type="checkbox" checked={s.enabled} onChange={(e) => update({ schedule: { enabled: e.target.checked } })} />
            Run this queue on a schedule
          </label>
        </legend>
        <div className={`schedule-body${s.enabled ? '' : ' disabled'}`}>
          <div className="form-row">
            <Field label="Start at">
              <div className="input-with-btn">
                <input className="input" type="time" disabled={!s.enabled} value={s.startTime ?? ''} onChange={(e) => update({ schedule: { startTime: e.target.value || null } })} />
                {s.startTime && (
                  <button className="icon-btn" aria-label="Clear start time" disabled={!s.enabled} onClick={() => update({ schedule: { startTime: null } })}>
                    <X size={14} />
                  </button>
                )}
              </div>
            </Field>
            <Field label="Stop at" hint="Leave empty to run until the queue is empty">
              <div className="input-with-btn">
                <input className="input" type="time" disabled={!s.enabled} value={s.stopTime ?? ''} onChange={(e) => update({ schedule: { stopTime: e.target.value || null } })} />
                {s.stopTime && (
                  <button className="icon-btn" aria-label="Clear stop time" disabled={!s.enabled} onClick={() => update({ schedule: { stopTime: null } })}>
                    <X size={14} />
                  </button>
                )}
              </div>
            </Field>
          </div>
          <div className="days" role="group" aria-label="Days">
            <span className="field-label">Days</span>
            {DAYS.map((label, i) => {
              const on = s.days.length === 0 || s.days.includes(i);
              return (
                <button
                  key={label}
                  className={`day${on ? ' on' : ''}`}
                  aria-pressed={on}
                  disabled={!s.enabled}
                  onClick={() => {
                    const all = s.days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : s.days;
                    const next = on ? all.filter((x) => x !== i) : [...all, i];
                    update({ schedule: { days: next.length === 7 ? [] : next } });
                  }}
                >
                  {label}
                </button>
              );
            })}
            <span className="muted days-note">{s.days.length === 0 ? 'Every day' : ''}</span>
          </div>
        </div>
      </fieldset>

      <div className="queue-files">
        <div className="queue-files-head">
          <span className="panel-title">Files in this queue</span>
          <span className="muted">{files.length}</span>
        </div>
        <div className="queue-files-list">
          {files.length === 0 ? (
            <div className="muted queue-files-empty">Use “Download later” in the Add dialog, or right-click downloads and choose Move to queue.</div>
          ) : (
            files.map((d, i) => (
              <div key={d.id} className="queue-file">
                <span className="muted tabular">{i + 1}</span>
                <FileIcon category={d.category} />
                <span className="ellipsis flex-1">{d.fileName}</span>
                <span className="muted tabular">{formatBytes(d.size)}</span>
                <StatusPill status={d.status} />
                <button className="icon-btn xs" aria-label="Move up" disabled={i === 0} onClick={() => attempt(() => api.bulk([d.id], 'moveUp'))}>
                  <ArrowUp size={14} />
                </button>
                <button className="icon-btn xs" aria-label="Move down" disabled={i === files.length - 1} onClick={() => attempt(() => api.bulk([d.id], 'moveDown'))}>
                  <ArrowDown size={14} />
                </button>
                <button className="icon-btn xs" aria-label="Remove from queue" title="Remove from queue" onClick={() => attempt(() => api.bulk([d.id], 'moveToQueue'))}>
                  <X size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
