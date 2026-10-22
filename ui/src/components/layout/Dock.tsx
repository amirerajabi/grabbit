import { FolderTree, ListOrdered } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { DOCK_MAX, DOCK_MIN, useUi, type DockPanel } from '../../store/ui';
import { Splitter } from '../common/Splitter';
import { CategoriesPanel } from '../Sidebar/CategoriesPanel';
import { QueuesPanel } from '../Sidebar/QueuesPanel';

const TABS: { id: DockPanel; label: string; Icon: typeof FolderTree }[] = [
  { id: 'categories', label: 'Categories', Icon: FolderTree },
  { id: 'queues', label: 'Queues', Icon: ListOrdered },
];

const AUTO_WIDTH = `clamp(${DOCK_MIN}px, 20vw, ${DOCK_MAX - 120}px)`;

/** Left dock: Categories | Queues, tabbed, resizable, collapsible (Ctrl+B). */
export function Dock() {
  const visible = useUi((s) => s.sidebarVisible);
  const width = useUi((s) => s.sidebarWidth);
  const dock = useUi((s) => s.dock);
  const ref = useRef<HTMLElement>(null);
  const [start, setStart] = useState(width);
  if (!visible) return null;

  const onKeyDown = (e: KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === dock);
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    useUi.getState().setLayout({ dock: TABS[n].id });
    setTimeout(() => document.getElementById(`dock-tab-${TABS[n].id}`)?.focus(), 0);
  };

  return (
    <>
      <aside ref={ref} className="dock" style={{ width: width > 0 ? Math.max(DOCK_MIN, Math.min(DOCK_MAX, width)) : AUTO_WIDTH }} aria-label="Side panel">
        <div className="dock-tabs" role="tablist" aria-label="Side panel" onKeyDown={onKeyDown}>
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`dock-tab-${t.id}`}
              role="tab"
              aria-selected={dock === t.id}
              tabIndex={dock === t.id ? 0 : -1}
              className={`dock-tab${dock === t.id ? ' active' : ''}`}
              onClick={() => useUi.getState().setLayout({ dock: t.id })}
            >
              <t.Icon size={14} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <div className="dock-body" role="tabpanel" aria-labelledby={`dock-tab-${dock}`}>
          {dock === 'categories' ? <CategoriesPanel /> : <QueuesPanel />}
        </div>
      </aside>
      <Splitter
        direction="vertical"
        ariaLabel="Resize side panel"
        onDragStart={() => setStart(ref.current?.offsetWidth ?? DOCK_MIN)}
        onDrag={(d) => useUi.getState().setLayout({ sidebarWidth: Math.max(DOCK_MIN, Math.min(DOCK_MAX, start + d)) })}
        onDoubleClick={() => useUi.getState().setLayout({ sidebarWidth: 0 })}
      />
    </>
  );
}
