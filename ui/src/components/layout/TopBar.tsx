import { Menu as MenuIcon, Moon, Search, Sun, SunMoon } from 'lucide-react';
import { getCommand, runCommand } from '../../app/commands';
import { withShortcut } from '../../app/keys';
import { useEngine } from '../../store/engine';
import { useUi } from '../../store/ui';
import type { EffectiveTheme } from '../../theme/theme';
import { CommandButton } from '../common/CommandButton';
import { showMenuBelow, type MenuItem } from '../common/Menu';
import { BrandMark, Kbd } from '../common/visuals';

const MENU: { label: string; ids: (string | '-')[] }[] = [
  { label: 'Tasks', ids: ['download.add', 'download.batch', '-', 'view.openDownloads', '-', 'view.settings'] },
  { label: 'Downloads', ids: ['download.resume', 'download.pause', 'download.pauseAll', '-', 'download.redownload', 'download.delete', 'download.deleteCompleted'] },
  { label: 'Queues', ids: ['queue.start', 'queue.stop', '-', 'queue.scheduler', 'speed.toggle'] },
  { label: 'View', ids: ['view.toggleSidebar', 'view.toggleDetails', 'view.toggleTheme', '-', 'view.palette', 'view.shortcuts'] },
];

function appMenu(): MenuItem[] {
  return MENU.map((m) => ({
    label: m.label,
    submenu: m.ids.map((id): MenuItem => {
      if (id === '-') return 'separator';
      const c = getCommand(id)!;
      return { label: c.label, icon: c.icon, shortcut: c.shortcut, disabled: c.disabled?.() ?? false, run: () => runCommand(id) };
    }),
  }));
}

/** Glass top bar (Rowlit style): brand, app menu, side panel toggle, Add URL / Batch, palette trigger, theme, options. */
export function TopBar({ theme }: { theme: EffectiveTheme }) {
  const pref = useEngine((s) => s.settings?.theme ?? 'system');
  const sidebar = useUi((s) => s.sidebarVisible);
  const ThemeIcon = pref === 'system' ? SunMoon : theme === 'dark' ? Moon : Sun;
  const next = pref === 'system' ? 'dark' : pref === 'dark' ? 'light' : 'system';
  const paletteShortcut = getCommand('view.palette')?.shortcut;

  return (
    <header className="topbar" aria-label="Application">
      <div className="brand">
        <BrandMark size={18} />
        <span className="brand-name">Grabbit</span>
      </div>
      <button className="icon-btn" title="Menu" aria-label="Application menu" aria-haspopup="menu" onClick={(e) => showMenuBelow(e.currentTarget, appMenu())}>
        <MenuIcon size={16} />
      </button>
      <CommandButton command="view.toggleSidebar" variant="icon" className={sidebar ? 'on' : ''} />
      <div className="topbar-sep" />
      <CommandButton command="download.add" variant="ghost" label="Add URL" className="topbar-text-btn" />
      <CommandButton command="download.batch" variant="ghost" label="Batch" className="topbar-text-btn" />
      <div className="flex-1 topbar-drag" />
      <button
        type="button"
        className="palette-trigger"
        onClick={() => useUi.getState().set({ paletteOpen: true })}
        title={withShortcut('Search downloads and commands', paletteShortcut)}
        aria-label="Search downloads and commands"
      >
        <Search size={14} />
        <span className="palette-trigger-text">Search downloads or run a command</span>
        <Kbd shortcut={paletteShortcut} />
      </button>
      <div className="flex-1 topbar-drag" />
      <button className="icon-btn" title={`Theme: ${pref} — click for ${next}`} aria-label={`Theme ${pref}, switch to ${next}`} onClick={() => runCommand('view.toggleTheme')}>
        <ThemeIcon size={16} />
      </button>
      <CommandButton command="view.shortcuts" variant="icon" />
      <CommandButton command="view.settings" variant="icon" />
    </header>
  );
}
