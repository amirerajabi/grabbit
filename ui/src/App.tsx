import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { boot, reloadState } from './app/boot';
import { installKeyboard } from './app/commands';
import { AddDownloadDialog } from './components/AddDownload/AddDownloadDialog';
import { BatchDialog } from './components/AddDownload/BatchDialog';
import { CommandPalette } from './components/CommandPalette/CommandPalette';
import { ConfirmDialog } from './components/common/ConfirmDialog';
import { MenuHost } from './components/common/Menu';
import { Splitter } from './components/common/Splitter';
import { Toasts } from './components/common/Toasts';
import { DetailsPane } from './components/DetailsPane/DetailsPane';
import { DownloadList } from './components/DownloadList/DownloadList';
import { Dock } from './components/layout/Dock';
import { TopBar } from './components/layout/TopBar';
import { PropertiesDialog } from './components/Properties/PropertiesDialog';
import { QueuesDialog } from './components/Queues/QueuesDialog';
import { SettingsDialog } from './components/Settings/SettingsDialog';
import { ShortcutSheet } from './components/Shortcuts/ShortcutSheet';
import { StatusBar } from './components/StatusBar/StatusBar';
import { Toolbar } from './components/Toolbar/Toolbar';
import { WhenDoneCountdown } from './components/WhenDone/WhenDone';
import { useUi } from './store/ui';
import { useTheme } from './theme/theme';

/** Shell (Rowlit layout): glass top bar, dock | workspace (toolbar, list, details), status bar, overlays. */
export default function App() {
  const theme = useTheme();
  useEffect(() => {
    boot();
    return installKeyboard();
  }, []);

  return (
    <div className="app">
      <TopBar theme={theme} />
      <EngineBanner />
      <div className="main">
        <Dock />
        <section className="workspace" aria-label="Downloads">
          <Toolbar />
          <Workspace />
        </section>
      </div>
      <StatusBar />
      <MenuHost />
      <AddDownloadDialog />
      <BatchDialog />
      <PropertiesDialog />
      <QueuesDialog />
      <SettingsDialog />
      <CommandPalette />
      <ShortcutSheet />
      <ConfirmDialog />
      <WhenDoneCountdown />
      <Toasts />
    </div>
  );
}

/** List over details, with a draggable split; the details height is remembered. */
function Workspace() {
  const visible = useUi((s) => s.detailsVisible);
  const height = useUi((s) => s.detailsHeight);
  const ref = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState(0);
  return (
    <div className="workspace-body" ref={ref}>
      <DownloadList />
      {visible && (
        <>
          <Splitter
            direction="horizontal"
            ariaLabel="Resize details pane"
            onDragStart={() => setStart((ref.current?.querySelector('.details') as HTMLElement | null)?.offsetHeight ?? 260)}
            onDrag={(d) => {
              const max = (ref.current?.clientHeight ?? 600) - 120;
              useUi.getState().setLayout({ detailsHeight: Math.max(150, Math.min(max, start - d)) });
            }}
            onDoubleClick={() => useUi.getState().setLayout({ detailsHeight: 0 })}
          />
          <div className="details-host" style={{ height: height > 0 ? height : undefined }}>
            <DetailsPane />
          </div>
        </>
      )}
    </div>
  );
}

function EngineBanner() {
  const err = useUi((s) => s.engineError);
  const ws = useUi((s) => s.wsStatus);
  if (!err && ws !== 'reconnecting') return null;
  return (
    <div className="engine-banner" role="alert">
      <span>{err ?? 'Lost the connection to the Grabbit engine. Reconnecting…'}</span>
      <button className="btn btn-xs" onClick={() => void reloadState()}>
        <RefreshCw size={12} /> Retry
      </button>
    </div>
  );
}
