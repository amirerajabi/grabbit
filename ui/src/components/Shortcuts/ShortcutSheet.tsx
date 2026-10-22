import { Keyboard } from 'lucide-react';
import { COMMANDS } from '../../app/commands';
import { useUi } from '../../store/ui';
import { Dialog } from '../common/Dialog';
import { Kbd } from '../common/visuals';

const EXTRA: { label: string; shortcut: string }[] = [
  { label: 'Extend the selection', shortcut: 'Shift+↑' },
  { label: 'Context menu', shortcut: 'Shift+F10' },
];

export function ShortcutSheet() {
  const open = useUi((s) => s.shortcutsOpen);
  if (!open) return null;
  const rows = [...COMMANDS.filter((c) => c.shortcut).map((c) => ({ label: c.label.replace('…', ''), shortcut: c.shortcut! })), ...EXTRA];
  return (
    <Dialog title="Keyboard shortcuts" icon={<Keyboard size={18} className="text-accent" />} width={520} onClose={() => useUi.getState().set({ shortcutsOpen: false })}>
      <div className="shortcut-list">
        {rows.map((r) => (
          <div key={r.label} className="shortcut-row">
            <span>{r.label}</span>
            <Kbd shortcut={r.shortcut} />
          </div>
        ))}
      </div>
    </Dialog>
  );
}
