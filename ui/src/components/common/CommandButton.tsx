import { getCommand, runCommand } from '../../app/commands';
import { withShortcut } from '../../app/keys';
import { useDownloads } from '../../store/downloads';
import { useEngine } from '../../store/engine';

interface Props {
  command: string;
  /** Show the label next to the icon (toolbar) or icon only (top bar). */
  label?: boolean | string;
  variant?: 'ghost' | 'icon' | 'tool';
  className?: string;
}

/**
 * A button bound to a command: icon, label, tooltip with shortcut and the disabled reason all come from the registry.
 * It re-renders on selection, item and queue changes so `disabled()` stays current.
 */
export function CommandButton({ command, label, variant = 'tool', className = '' }: Props) {
  useDownloads((s) => s.selected);
  useDownloads((s) => s.items);
  useEngine((s) => s.queues);
  const c = getCommand(command);
  if (!c) return null;
  const reason = c.disabled?.() ?? null;
  const text = typeof label === 'string' ? label : c.label.replace('…', '');
  const Icon = c.icon;
  const cls = variant === 'icon' ? 'icon-btn' : variant === 'ghost' ? 'btn btn-ghost' : 'tool-btn';
  return (
    <button
      type="button"
      className={`${cls} ${className}`}
      title={reason ?? withShortcut(c.label.replace('…', ''), c.shortcut)}
      aria-label={c.label.replace('…', '')}
      aria-disabled={reason ? true : undefined}
      onClick={() => !reason && runCommand(command)}
    >
      {Icon && <Icon size={variant === 'tool' ? 20 : 16} />}
      {label !== undefined && label !== false && <span className="btn-text">{text}</span>}
    </button>
  );
}
