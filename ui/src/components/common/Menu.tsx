import { Check, ChevronRight, type LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { displayShortcut } from '../../app/keys';

export type MenuItem =
  | 'separator'
  | {
      label: string;
      icon?: LucideIcon;
      shortcut?: string;
      disabled?: boolean | string;
      danger?: boolean;
      checked?: boolean;
      run?: () => unknown;
      submenu?: MenuItem[];
    };

interface MenuState {
  open: { x: number; y: number; items: MenuItem[] } | null;
  show(x: number, y: number, items: MenuItem[]): void;
  hide(): void;
}

export const useMenu = create<MenuState>((set) => ({
  open: null,
  show: (x, y, items) => set({ open: { x, y, items } }),
  hide: () => set({ open: null }),
}));

export function showMenuBelow(el: HTMLElement, items: MenuItem[]): void {
  const r = el.getBoundingClientRect();
  useMenu.getState().show(r.left, r.bottom + 4, items);
}

/** The one open context menu / dropdown. */
export function MenuHost() {
  const open = useMenu((s) => s.open);
  if (!open) return null;
  return (
    <div className="menu-backdrop" onMouseDown={() => useMenu.getState().hide()} onContextMenu={(e) => (e.preventDefault(), useMenu.getState().hide())}>
      <MenuList x={open.x} y={open.y} items={open.items} root />
    </div>
  );
}

function MenuList({ x, y, items, root, onLeave }: { x: number; y: number; items: MenuItem[]; root?: boolean; onLeave?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [active, setActive] = useState(-1);
  const [sub, setSub] = useState<{ index: number; x: number; y: number } | null>(null);

  // Keep the menu on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
  }, [x, y]);

  useEffect(() => {
    if (root) ref.current?.focus();
  }, [root]);

  const enabled = (i: number) => {
    const it = items[i];
    return it !== 'separator' && !it.disabled;
  };

  const activate = (i: number) => {
    const it = items[i];
    if (it === 'separator' || it.disabled) return;
    if (it.submenu) {
      const row = ref.current?.children[i] as HTMLElement | undefined;
      const r = row?.getBoundingClientRect();
      if (r) setSub({ index: i, x: r.right - 2, y: r.top - 4 });
      return;
    }
    useMenu.getState().hide();
    void it.run?.();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      if (onLeave) onLeave();
      else useMenu.getState().hide();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      let i = active;
      for (let n = 0; n < items.length; n++) {
        i = (i + step + items.length) % items.length;
        if (enabled(i)) break;
      }
      setActive(i);
    } else if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (active >= 0) activate(active);
    } else if (e.key === 'ArrowLeft' && onLeave) {
      onLeave();
    }
  };

  const subItem = sub ? items[sub.index] : null;

  return (
    <>
      <div ref={ref} className="menu" role="menu" tabIndex={-1} style={pos} onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        {items.map((it, i) =>
          it === 'separator' ? (
            <div key={i} className="menu-sep" role="separator" />
          ) : (
            <div
              key={i}
              role="menuitem"
              aria-disabled={!!it.disabled}
              title={typeof it.disabled === 'string' ? it.disabled : undefined}
              className={`menu-item${i === active ? ' active' : ''}${it.disabled ? ' disabled' : ''}${it.danger ? ' danger' : ''}`}
              onMouseEnter={() => {
                setActive(i);
                if (it.submenu && !it.disabled) activate(i);
                else setSub(null);
              }}
              onClick={() => activate(i)}
            >
              <span className="menu-icon">{it.checked ? <Check size={16} /> : it.icon ? <it.icon size={16} /> : null}</span>
              <span className="menu-label">{it.label}</span>
              {it.shortcut && <span className="menu-shortcut">{displayShortcut(it.shortcut)}</span>}
              {it.submenu && <ChevronRight size={14} className="menu-chevron" />}
            </div>
          ),
        )}
      </div>
      {sub && subItem && subItem !== 'separator' && subItem.submenu && (
        <MenuList
          x={sub.x}
          y={sub.y}
          items={subItem.submenu}
          onLeave={() => {
            setSub(null);
            ref.current?.focus();
          }}
        />
      )}
    </>
  );
}
