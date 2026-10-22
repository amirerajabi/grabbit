import { CalendarClock, ListOrdered, Pause, Play, Plus, Settings2, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { api } from '../../api/client';
import { attempt } from '../../app/commands';
import { useDownloads } from '../../store/downloads';
import { useEngine } from '../../store/engine';
import { useUi } from '../../store/ui';
import { useMenu } from '../common/Menu';
import { TreeRow } from './CategoriesPanel';

/** Queues with their waiting count, a running indicator and a schedule badge; click filters the list to the queue. */
export function QueuesPanel() {
  const queues = useEngine((s) => s.queues);
  const items = useDownloads((s) => s.items);
  const filter = useDownloads((s) => s.filter);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of Object.values(items)) if (d.queueId && d.status !== 'completed') c[d.queueId] = (c[d.queueId] ?? 0) + 1;
    return c;
  }, [items]);

  const newQueue = async () => {
    const q = await attempt(() => api.createQueue(`Queue ${queues.length + 1}`));
    if (q) useUi.getState().set({ queuesOpen: q.id });
  };

  return (
    <div className="dock-panel">
      <div className="panel-header">
        <span className="panel-title">Queues</span>
        <div className="panel-actions">
          <button className="icon-btn sm" title="New queue" aria-label="New queue" onClick={newQueue}>
            <Plus size={16} />
          </button>
          <button className="icon-btn sm" title="Scheduler" aria-label="Scheduler" onClick={() => useUi.getState().set({ queuesOpen: queues[0]?.id ?? 'main' })}>
            <CalendarClock size={16} />
          </button>
        </div>
      </div>
      <div className="tree" role="tree" aria-label="Queues">
        {queues.map((q) => (
          <TreeRow
            key={q.id}
            depth={0}
            icon={<ListOrdered size={16} className={q.running ? 'text-success' : ''} />}
            label={q.name}
            count={counts[q.id] ?? 0}
            selected={filter.kind === 'queue' && filter.id === q.id}
            onClick={() => useDownloads.getState().setFilter({ kind: 'queue', id: q.id })}
            onContextMenu={(e) => {
              e.preventDefault();
              useMenu.getState().show(e.clientX, e.clientY, [
                q.running
                  ? { label: 'Stop queue', icon: Pause, run: () => attempt(() => api.stopQueue(q.id)) }
                  : { label: 'Start queue', icon: Play, run: () => attempt(() => api.startQueue(q.id)) },
                { label: 'Edit queue and schedule…', icon: Settings2, run: () => useUi.getState().set({ queuesOpen: q.id }) },
                'separator',
                { label: 'Delete queue', icon: Trash2, danger: true, disabled: q.builtIn ? 'The main queue cannot be deleted' : false, run: () => attempt(() => api.deleteQueue(q.id)) },
              ]);
            }}
            extra={
              <>
                {q.schedule.enabled && (
                  <span className="tree-badge" title={`Scheduled ${q.schedule.startTime ?? ''}${q.schedule.stopTime ? `–${q.schedule.stopTime}` : ''}`}>
                    <CalendarClock size={12} />
                  </span>
                )}
                <button
                  className="icon-btn xs tree-action"
                  title={q.running ? 'Stop queue' : 'Start queue'}
                  aria-label={q.running ? `Stop ${q.name}` : `Start ${q.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void attempt(() => (q.running ? api.stopQueue(q.id) : api.startQueue(q.id)));
                  }}
                >
                  {q.running ? <Pause size={14} /> : <Play size={14} />}
                </button>
              </>
            }
          />
        ))}
      </div>
      <p className="panel-note">Downloads added with “Download later” wait in a queue. Start it now or let the scheduler start it.</p>
    </div>
  );
}
