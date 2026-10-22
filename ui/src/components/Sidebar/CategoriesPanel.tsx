import { ChevronDown, ChevronRight, CircleCheckBig, CircleDashed, FolderOpen, Inbox } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { CategoryId } from '../../../../shared/protocol';
import { api } from '../../api/client';
import { attempt } from '../../app/commands';
import { categoryDir } from '../../lib/paths';
import { useDownloads, type Filter } from '../../store/downloads';
import { useEngine } from '../../store/engine';
import { useMenu } from '../common/Menu';
import { CategoryIcon } from '../common/visuals';

function same(a: Filter, b: Filter): boolean {
  return a.kind === b.kind && (a as { id?: string }).id === (b as { id?: string }).id;
}

/** IDM's category tree: All downloads (by file type), Unfinished, Finished — with live counts. */
export function CategoriesPanel() {
  const items = useDownloads((s) => s.items);
  const filter = useDownloads((s) => s.filter);
  const categories = useEngine((s) => s.categories);
  const [open, setOpen] = useState(true);

  const counts = useMemo(() => {
    const c = { all: 0, unfinished: 0, finished: 0, cat: {} as Record<string, number> };
    for (const d of Object.values(items)) {
      c.all++;
      if (d.status === 'completed') c.finished++;
      else c.unfinished++;
      c.cat[d.category] = (c.cat[d.category] ?? 0) + 1;
    }
    return c;
  }, [items]);

  const pick = (f: Filter) => useDownloads.getState().setFilter(f);
  const folderMenu = (e: React.MouseEvent, id?: CategoryId) => {
    e.preventDefault();
    const dir = id ? undefined : useEngine.getState().settings?.downloadDir;
    useMenu.getState().show(e.clientX, e.clientY, [
      {
        label: 'Open folder',
        icon: FolderOpen,
        run: () => attempt(() => api.openFolder(id ? folderOf(id) : dir), 'Could not open the folder'),
      },
    ]);
  };

  return (
    <div className="tree" role="tree" aria-label="Categories">
      <TreeRow
        depth={0}
        icon={<Inbox size={16} />}
        label="All downloads"
        count={counts.all}
        selected={same(filter, { kind: 'all' })}
        onClick={() => pick({ kind: 'all' })}
        onContextMenu={(e) => folderMenu(e)}
        twisty={
          <button className="tree-twisty" aria-label={open ? 'Collapse' : 'Expand'} onClick={(e) => (e.stopPropagation(), setOpen(!open))}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        }
      />
      {open &&
        categories
          .filter((c) => c.id !== 'general')
          .concat(categories.filter((c) => c.id === 'general'))
          .map((c) => (
            <TreeRow
              key={c.id}
              depth={1}
              icon={<CategoryIcon category={c.id} />}
              label={c.label}
              count={counts.cat[c.id] ?? 0}
              selected={same(filter, { kind: 'category', id: c.id })}
              onClick={() => pick({ kind: 'category', id: c.id })}
              onContextMenu={(e) => folderMenu(e, c.id)}
            />
          ))}
      <div className="tree-gap" />
      <TreeRow depth={0} icon={<CircleDashed size={16} className="text-accent" />} label="Unfinished" count={counts.unfinished} selected={same(filter, { kind: 'unfinished' })} onClick={() => pick({ kind: 'unfinished' })} />
      <TreeRow depth={0} icon={<CircleCheckBig size={16} className="text-success" />} label="Finished" count={counts.finished} selected={same(filter, { kind: 'finished' })} onClick={() => pick({ kind: 'finished' })} />
    </div>
  );
}

function folderOf(id: CategoryId): string | undefined {
  const s = useEngine.getState().settings;
  return s ? categoryDir(s, id) : undefined;
}

export function TreeRow(props: {
  depth: number;
  icon: ReactNode;
  label: string;
  count?: number;
  selected: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  twisty?: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <div
      role="treeitem"
      aria-selected={props.selected}
      tabIndex={props.selected ? 0 : -1}
      className={`tree-row${props.selected ? ' selected' : ''}`}
      style={{ paddingLeft: 8 + props.depth * 16 }}
      onClick={props.onClick}
      onContextMenu={props.onContextMenu}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          props.onClick();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const rows = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('.tree-row') ?? [])];
          const i = rows.indexOf(e.currentTarget);
          const next = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
          next?.click();
          next?.focus();
        }
      }}
    >
      <span className="tree-twisty-slot">{props.twisty}</span>
      <span className="tree-icon">{props.icon}</span>
      <span className="tree-label">{props.label}</span>
      {props.extra}
      {props.count !== undefined && <span className="tree-count">{props.count}</span>}
    </div>
  );
}
