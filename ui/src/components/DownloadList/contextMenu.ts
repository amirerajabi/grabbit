import { ArrowDown, ArrowUp, ListOrdered, ListX } from 'lucide-react';
import { api } from '../../api/client';
import { attempt, getCommand, runCommand, selectedItems } from '../../app/commands';
import { useEngine } from '../../store/engine';
import type { MenuItem } from '../common/Menu';

function cmd(id: string, label?: string): MenuItem {
  const c = getCommand(id)!;
  return { label: label ?? c.label, icon: c.icon, shortcut: c.shortcut, disabled: c.disabled?.() ?? false, run: () => runCommand(id) };
}

/** Right-click menu of the download list (acts on the selection). */
export function listMenu(): MenuItem[] {
  const sel = selectedItems();
  const ids = sel.map((d) => d.id);
  const queues = useEngine.getState().queues;
  const done = sel.length > 0 && sel.every((d) => d.status === 'completed');
  const inQueue = sel.some((d) => d.queueId && d.status !== 'completed');
  return [
    ...(done ? [cmd('download.open'), cmd('download.openFolder')] : [cmd('download.resume'), cmd('download.pause'), cmd('download.openFolder')]),
    'separator',
    cmd('download.redownload'),
    {
      label: 'Move to queue',
      icon: ListOrdered,
      disabled: done ? 'Completed downloads are not queued' : false,
      submenu: [
        ...queues.map((q): MenuItem => ({ label: q.name, checked: sel.length > 0 && sel.every((d) => d.queueId === q.id), run: () => attempt(() => api.bulk(ids, 'moveToQueue', q.id)) })),
        'separator',
        { label: 'Remove from queue', icon: ListX, disabled: !inQueue, run: () => attempt(() => api.bulk(ids, 'moveToQueue')) },
      ],
    },
    { label: 'Move up in queue', icon: ArrowUp, disabled: !inQueue, run: () => attempt(() => api.bulk(ids, 'moveUp')) },
    { label: 'Move down in queue', icon: ArrowDown, disabled: !inQueue, run: () => attempt(() => api.bulk(ids, 'moveDown')) },
    'separator',
    cmd('download.copyUrl'),
    cmd('download.properties'),
    'separator',
    { ...(cmd('download.delete') as Exclude<MenuItem, 'separator'>), danger: true },
  ];
}
