import { useEffect, useState } from 'react';
import type { ThemePref } from '../../../shared/protocol';
import { getPlatform } from '../platform';
import { useEngine } from '../store/engine';

export type EffectiveTheme = 'light' | 'dark';

const KEY = 'grabbit.theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

function resolve(pref: ThemePref): EffectiveTheme {
  return pref === 'system' ? (media().matches ? 'dark' : 'light') : pref;
}

function apply(theme: EffectiveTheme): void {
  const root = document.documentElement;
  if (root.dataset.theme === theme) return;
  root.dataset.theme = theme;
  const css = getComputedStyle(root);
  // The window's caption buttons (Windows title bar overlay) follow the theme.
  getPlatform().setTheme(theme, { bg: css.getPropertyValue('--bg-app').trim(), fg: css.getPropertyValue('--fg').trim() });
}

/** First paint: the last used theme, so a dark user never sees a white flash before settings load. */
export function applyBootTheme(): void {
  let pref: ThemePref = 'system';
  try {
    pref = (localStorage.getItem(KEY) as ThemePref | null) ?? 'system';
  } catch {
    /* private mode */
  }
  apply(resolve(pref));
}

/** Follows settings.theme and, for 'system', the OS appearance live. */
export function useTheme(): EffectiveTheme {
  const pref = useEngine((s) => s.settings?.theme);
  const [theme, setTheme] = useState<EffectiveTheme>(() => (document.documentElement.dataset.theme as EffectiveTheme) ?? 'light');
  useEffect(() => {
    if (!pref) return;
    try {
      localStorage.setItem(KEY, pref);
    } catch {
      /* private mode */
    }
    const update = () => {
      const t = resolve(pref);
      apply(t);
      setTheme(t);
    };
    update();
    const mq = media();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [pref]);
  return theme;
}
