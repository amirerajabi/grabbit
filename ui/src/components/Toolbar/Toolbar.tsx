import { Search, X } from 'lucide-react';
import { getCommand } from '../../app/commands';
import { withShortcut } from '../../app/keys';
import { useDownloads } from '../../store/downloads';
import { CommandButton } from '../common/CommandButton';

const GROUPS: string[][] = [
  ['download.add', 'download.resume', 'download.pause', 'download.pauseAll'],
  ['download.delete', 'download.deleteCompleted'],
  ['queue.start', 'queue.stop', 'queue.scheduler'],
  ['view.settings'],
];

const SHORT: Record<string, string> = {
  'download.add': 'Add URL',
  'download.resume': 'Resume',
  'download.pause': 'Stop',
  'download.pauseAll': 'Stop all',
  'download.delete': 'Delete',
  'download.deleteCompleted': 'Delete done',
  'queue.start': 'Start queue',
  'queue.stop': 'Stop queue',
  'queue.scheduler': 'Scheduler',
  'view.settings': 'Options',
};

/** IDM's main toolbar (big icon over label), with the list's quick filter on the right. */
export function Toolbar() {
  const query = useDownloads((s) => s.query);
  const filterShortcut = getCommand('view.focusFilter')?.shortcut;
  return (
    <div className="toolbar" role="toolbar" aria-label="Downloads">
      {GROUPS.map((g, i) => (
        <div key={i} className="tool-group">
          {g.map((id) => (
            <CommandButton key={id} command={id} label={SHORT[id]} />
          ))}
        </div>
      ))}
      <div className="flex-1" />
      <div className="search-box" title={withShortcut('Filter downloads', filterShortcut)}>
        <Search size={14} />
        <input
          id="list-filter"
          className="input borderless"
          placeholder="Filter by name or address"
          value={query}
          onChange={(e) => useDownloads.getState().setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              useDownloads.getState().setQuery('');
              (document.querySelector('.dl-list') as HTMLElement | null)?.focus();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              (document.querySelector('.dl-list') as HTMLElement | null)?.focus();
            }
          }}
        />
        {query && (
          <button className="icon-btn xs" aria-label="Clear filter" onClick={() => useDownloads.getState().setQuery('')}>
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
