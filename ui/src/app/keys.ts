import { getPlatform } from '../platform';

export const isMac = () => getPlatform().os === 'darwin';

/** "Mod+Shift+N" -> ["Ctrl", "Shift", "N"] (or ["⌘", "⇧", "N"] on macOS). */
export function shortcutParts(shortcut: string | undefined): string[] {
  if (!shortcut) return [];
  const mac = isMac();
  return shortcut.split('+').map((k) => {
    switch (k) {
      case 'Mod':
        return mac ? '⌘' : 'Ctrl';
      case 'Shift':
        return mac ? '⇧' : 'Shift';
      case 'Alt':
        return mac ? '⌥' : 'Alt';
      case 'Delete':
        return mac ? '⌫' : 'Del';
      case 'Enter':
        return mac ? '↩' : 'Enter';
      case 'Space':
        return 'Space';
      default:
        return k;
    }
  });
}

export function displayShortcut(shortcut: string | undefined): string {
  return shortcutParts(shortcut).join(isMac() ? '' : '+');
}

export function withShortcut(label: string, shortcut?: string): string {
  return shortcut ? `${label} (${displayShortcut(shortcut)})` : label;
}

/** Does this keydown match "Mod+Shift+N"-style `shortcut`? */
export function matches(e: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split('+');
  const key = parts[parts.length - 1];
  const mod = parts.includes('Mod');
  const wantShift = parts.includes('Shift');
  const wantAlt = parts.includes('Alt');
  const modDown = isMac() ? e.metaKey : e.ctrlKey;
  if (mod !== modDown || wantShift !== e.shiftKey || wantAlt !== e.altKey) return false;
  if (!isMac() && e.metaKey) return false;
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (key === 'Space') return e.code === 'Space';
  if (key === 'Delete') return e.key === 'Delete' || (isMac() && e.key === 'Backspace');
  return k === key || e.code === `Key${key}`;
}
