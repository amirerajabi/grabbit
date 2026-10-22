import { ArrowDownCircle, ArrowDownToLine, CircleAlert, ClipboardList, Gauge, ListOrdered, LoaderCircle, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { updateChip, useUpdates } from '../../store/updates';
import { useMemo } from 'react';
import { runCommand } from '../../app/commands';
import { formatBytes, formatSpeed, pluralize } from '../../lib/format';
import { getPlatform } from '../../platform';
import { ACTIVE, useDownloads } from '../../store/downloads';
import { useEngine } from '../../store/engine';
import { useUi } from '../../store/ui';

const WS_LABEL = { connecting: 'Engine: connecting…', open: 'Engine connected', reconnecting: 'Engine: reconnecting…', closed: 'Engine: disconnected' };

export function StatusBar() {
  const ws = useUi((s) => s.wsStatus);
  const items = useDownloads((s) => s.items);
  const totalSpeed = useDownloads((s) => s.totalSpeed);
  const selected = useDownloads((s) => s.selected);
  const settings = useEngine((s) => s.settings);
  const queues = useEngine((s) => s.queues);

  const counts = useMemo(() => {
    let active = 0;
    let queued = 0;
    let selSize = 0;
    for (const d of Object.values(items)) {
      if (ACTIVE.has(d.status)) active++;
      else if (d.status === 'queued') queued++;
    }
    for (const id of selected) selSize += items[id]?.size ?? 0;
    return { active, queued, selSize };
  }, [items, selected]);

  const running = queues.filter((q) => q.running);
  const limiterOn = settings?.speedLimitEnabled && (settings?.speedLimit ?? 0) > 0;

  return (
    <footer className="statusbar" aria-label="Status bar">
      <span className={`sb-item sb-ws ws-${ws}`} title={WS_LABEL[ws]} role="img" aria-label={WS_LABEL[ws]}>
        {ws === 'open' ? <Wifi size={12} /> : <WifiOff size={12} />}
      </span>
      <span className="sb-item">
        <ArrowDownToLine size={12} />
        {counts.active > 0 ? `${pluralize(counts.active, 'download')} · ${formatSpeed(totalSpeed)}` : 'Idle'}
      </span>
      {counts.queued > 0 && <span className="sb-item muted">{counts.queued} queued</span>}
      {running.length > 0 && (
        <button className="sb-item sb-button" onClick={() => useUi.getState().set({ queuesOpen: running[0].id })} title="Running queues">
          <ListOrdered size={12} className="text-success" />
          {running.map((q) => q.name).join(', ')} running
        </button>
      )}
      <div className="flex-1" />
      {selected.length > 1 && (
        <span className="sb-item muted">
          {selected.length} selected · {formatBytes(counts.selSize)}
        </span>
      )}
      {getPlatform().kind === 'electron' && settings && (
        <button
          className={`sb-item sb-button${settings.clipboardMonitor ? '' : ' muted'}`}
          title={settings.clipboardMonitor ? 'Clipboard monitoring is on: copied download links open the Add dialog' : 'Clipboard monitoring is off'}
          onClick={() => useEngine.getState().updateSettings({ clipboardMonitor: !settings.clipboardMonitor })}
        >
          <ClipboardList size={12} />
          Clipboard {settings.clipboardMonitor ? 'on' : 'off'}
        </button>
      )}
      <UpdateChip />
      <button
        className={`sb-item sb-button${limiterOn ? ' sb-warn' : ''}`}
        title={limiterOn ? `Speed limiter on (${formatSpeed(settings!.speedLimit)}). Click to turn off.` : 'Speed limiter off. Click to turn on.'}
        onClick={() => runCommand('speed.toggle')}
      >
        <Gauge size={12} />
        {limiterOn ? `Limit ${formatSpeed(settings!.speedLimit)}` : 'No limit'}
      </button>
    </footer>
  );
}

/**
 * The update state at the right of the status bar (Rowlit's update chip): checking, download progress with a small bar,
 * "Restart to update" once ready, a new version on macOS, or a quiet mark after a failed check.
 */
function UpdateChip() {
  const status = useUpdates((s) => s.status);
  const chip = updateChip(status);
  if (!status || !chip) return null;
  const ready = status.state === 'ready';
  const error = status.state === 'error';
  const Icon = status.state === 'checking' ? LoaderCircle : ready ? RefreshCw : error ? CircleAlert : ArrowDownCircle;
  return (
    <button
      className={`sb-item sb-button sb-update tone-${chip.tone}`}
      title={ready ? `${chip.text}. Click to restart now.` : error ? `${chip.text}: ${status.message ?? ''}` : chip.text}
      aria-label={chip.text}
      onClick={() => (ready || status.state === 'available' ? void useUpdates.getState().install() : useUi.getState().set({ settingsOpen: 'updates' }))}
    >
      <Icon size={12} className={status.state === 'checking' ? 'spin' : undefined} />
      {/* a failed check is a quiet mark only: an offline machine should not carry a red label all day */}
      {!error && <span>{chip.text}</span>}
      {status.state === 'downloading' && (
        <span className="sb-update-bar" aria-hidden="true">
          <span className="sb-update-fill" style={{ width: `${status.percent ?? 0}%` }} />
        </span>
      )}
    </button>
  );
}
