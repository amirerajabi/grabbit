import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { getPlatform } from './platform';
import { applyBootTheme } from './theme/theme';
import './theme/tokens.css';
import './theme/app.css';

applyBootTheme();
if (import.meta.env.DEV) {
  // Dev builds only: stores on window for inspection from DevTools.
  void Promise.all([import('./store/ui'), import('./store/downloads'), import('./store/engine')]).then(([ui, dl, en]) => {
    Object.assign(window, { __grabbit: { ui: ui.useUi, downloads: dl.useDownloads, engine: en.useEngine } });
  });
}
const platform = getPlatform();
document.documentElement.classList.add(`os-${platform.os}`);
if (platform.titleBar) document.documentElement.classList.add(`titlebar-${platform.titleBar}`);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
