import { Download, FolderOpen, Gauge, Globe, Info, ListChecks, LoaderCircle, Network, RefreshCw, Settings, SlidersHorizontal } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { Settings as SettingsT } from '../../../../shared/protocol';
import { attempt } from '../../app/commands';
import { formatSpeed, parseRate } from '../../lib/format';
import { getPlatform } from '../../platform';
import { useEngine } from '../../store/engine';
import { useUi, type SettingsSection } from '../../store/ui';
import { useUpdates } from '../../store/updates';
import { Dialog, Field } from '../common/Dialog';
import { BrandMark } from '../common/visuals';
import { WHEN_DONE_LABEL } from '../WhenDone/WhenDone';

const SECTIONS: { id: SettingsSection; label: string; Icon: typeof Settings }[] = [
  { id: 'general', label: 'General', Icon: SlidersHorizontal },
  { id: 'connection', label: 'Connection', Icon: Network },
  { id: 'saveto', label: 'Save to', Icon: FolderOpen },
  { id: 'speed', label: 'Speed limiter', Icon: Gauge },
  { id: 'after', label: 'After download', Icon: ListChecks },
  { id: 'integration', label: 'Browser & clipboard', Icon: Globe },
  { id: 'updates', label: 'Updates', Icon: RefreshCw },
  { id: 'about', label: 'About', Icon: Info },
];

/** Options (IDM) laid out like Rowlit's settings: section nav on the left, each change saved immediately. */
export function SettingsDialog() {
  const section = useUi((s) => s.settingsOpen);
  const settings = useEngine((s) => s.settings);
  if (!section || !settings) return null;
  const close = () => useUi.getState().set({ settingsOpen: null });
  return (
    <Dialog title="Options" icon={<Settings size={18} className="text-accent" />} width={760} className="settings-dialog" onClose={close} footer={<button className="btn btn-primary" onClick={close}>Done</button>}>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Sections">
          {SECTIONS.map((s) => (
            <button key={s.id} className={`nav-item${section === s.id ? ' active' : ''}`} onClick={() => useUi.getState().set({ settingsOpen: s.id })}>
              <s.Icon size={16} />
              {s.label}
            </button>
          ))}
        </nav>
        <div className="settings-body">
          <Section id={section} s={settings} />
        </div>
      </div>
    </Dialog>
  );
}

function save(patch: Partial<SettingsT>): void {
  void attempt(() => useEngine.getState().updateSettings(patch), 'Could not save the setting');
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle-row">
      <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="toggle-label">{label}</span>
        {hint && <span className="field-hint">{hint}</span>}
      </span>
    </label>
  );
}

/** A number field that saves on blur / Enter. */
function NumberField({ label, hint, value, min, max, onSave }: { label: string; hint?: string; value: number; min: number; max: number; onSave: (n: number) => void }) {
  const [v, setV] = useState(String(value));
  const commit = () => {
    const n = Number(v);
    if (Number.isFinite(n) && n !== value) onSave(Math.max(min, Math.min(max, Math.round(n))));
    else setV(String(value));
  };
  return (
    <Field label={label} hint={hint}>
      <input className="input narrow" type="number" min={min} max={max} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
    </Field>
  );
}

function TextField({ label, hint, value, onSave, mono }: { label: string; hint?: ReactNode; value: string; onSave: (v: string) => void; mono?: boolean }) {
  const [v, setV] = useState(value);
  const commit = () => v.trim() !== value && onSave(v.trim());
  return (
    <Field label={label} hint={hint}>
      <input className={`input${mono ? ' mono-sm' : ''}`} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} spellCheck={false} />
    </Field>
  );
}

function Section({ id, s }: { id: SettingsSection; s: SettingsT }) {
  const electron = getPlatform().kind === 'electron';
  switch (id) {
    case 'general':
      return (
        <div className="settings-section">
          <h3>General</h3>
          <Field label="Theme">
            <div className="segmented">
              {(['system', 'light', 'dark'] as const).map((t) => (
                <button key={t} className={s.theme === t ? 'on' : ''} aria-pressed={s.theme === t} onClick={() => save({ theme: t })}>
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </Field>
          <Toggle label="Show the Add dialog for captured downloads" hint="Off: links from the browser start downloading straight away." checked={s.showAddDialog} onChange={(v) => save({ showAddDialog: v })} />
          <Toggle label="Notify when a download finishes or fails" checked={s.notifyOnComplete} onChange={(v) => save({ notifyOnComplete: v })} />
          {electron && <Toggle label="Keep running in the tray when the window is closed" hint="Downloads continue in the background." checked={s.minimizeToTray} onChange={(v) => save({ minimizeToTray: v })} />}
        </div>
      );
    case 'connection':
      return (
        <div className="settings-section">
          <h3>Connection</h3>
          <NumberField label="Connections per download" hint="Grabbit splits a file into this many parts and downloads them in parallel (IDM's default is 8)." value={s.maxConnections} min={1} max={32} onSave={(n) => save({ maxConnections: n })} />
          <NumberField label="Retries" hint="Per connection, before the download is marked as failed." value={s.maxRetries} min={0} max={100} onSave={(n) => save({ maxRetries: n })} />
          <NumberField label="Retry delay (seconds)" value={s.retryDelaySec} min={1} max={600} onSave={(n) => save({ retryDelaySec: n })} />
          <NumberField label="Timeout (seconds)" hint="A connection that sends nothing for this long is reopened." value={s.timeoutSec} min={5} max={600} onSave={(n) => save({ timeoutSec: n })} />
          <TextField label="User agent" hint="Sent with every request. Some servers only answer browsers." value={s.userAgent} onSave={(v) => save({ userAgent: v })} mono />
          <ProxyFields s={s} />
        </div>
      );
    case 'saveto':
      return <SaveToSection s={s} />;
    case 'speed':
      return <SpeedSection s={s} />;
    case 'after':
      return <AfterSection s={s} />;
    case 'integration':
      return (
        <div className="settings-section">
          <h3>Browser &amp; clipboard</h3>
          {electron ? (
            <Toggle label="Watch the clipboard for download links" hint="Copying a link to one of the file types below opens the Add dialog." checked={s.clipboardMonitor} onChange={(v) => save({ clipboardMonitor: v })} />
          ) : (
            <p className="muted">Clipboard monitoring needs the desktop app.</p>
          )}
          <TextField label="File types to capture" hint="Extensions, separated by spaces." value={s.captureExtensions.join(' ')} onSave={(v) => save({ captureExtensions: v.split(/[\s,]+/) })} mono />
          <div className="info-card">
            <Globe size={18} className="text-accent" />
            <div>
              <strong>Browser extensions for Chrome, Edge and Firefox</strong>
              <p className="muted">
                They add “Download with Grabbit”, “Download selected links” and “Download all links” to the right-click menu, and hand browser downloads of the file types above to
                Grabbit. Get them from the{' '}
                <a href="https://github.com/amirerajabi/grabbit/blob/main/docs/browser-extensions.md" target="_blank" rel="noreferrer">
                  install guide
                </a>
                .
              </p>
            </div>
          </div>
        </div>
      );
    case 'updates':
      return <UpdatesSection s={s} />;
    case 'about':
      return (
        <div className="settings-section about">
          <BrandMark size={48} />
          <h3>Grabbit</h3>
          <p className="muted">
            {electron ? `Version ${getPlatform().appVersion} · ` : 'Browser build · '}engine {useEngine.getState().version}
          </p>
          <ul className="about-list">
            <li>
              <Download size={14} /> Up to 32 connections per file, with dynamic splitting: a finished connection takes over half of the largest part still downloading.
            </li>
            <li>
              <Download size={14} /> Pause, resume and survive restarts; expired links can be refreshed in Properties.
            </li>
            <li>
              <Download size={14} /> Queues with a scheduler, a global speed limiter, categories and browser capture.
            </li>
          </ul>
        </div>
      );
  }
}

const UPDATE_TEXT: Record<string, string> = {
  idle: 'Not checked yet.',
  checking: 'Checking for updates…',
  'up-to-date': 'Grabbit is up to date.',
  error: 'The last check failed.',
};

function UpdatesSection({ s }: { s: SettingsT }) {
  const status = useUpdates((u) => u.status);
  const manual = useUpdates((u) => u.manual);
  const busy = manual || status?.state === 'checking';
  let text = status ? UPDATE_TEXT[status.state] ?? '' : '';
  if (status?.state === 'downloading') text = `Downloading Grabbit ${status.version}: ${status.percent ?? 0}%`;
  if (status?.state === 'ready') text = `Grabbit ${status.version} is downloaded. Restart to install it, or it installs when you quit.`;
  if (status?.state === 'available') text = `Grabbit ${status.version} is available. macOS only updates signed apps in place, so download it from the release page.`;
  if (status?.state === 'disabled') text = status.message ?? 'Updates are not available in this build.';
  return (
    <div className="settings-section">
      <h3>Updates</h3>
      {!status ? (
        <p className="muted">Updates are part of the desktop app.</p>
      ) : (
        <>
          <div className="info-card">
            <RefreshCw size={18} className="text-accent" />
            <div className="flex-1">
              <strong>Grabbit {status.currentVersion}</strong>
              <p className={`muted${status.state === 'error' ? ' text-danger' : ''}`}>
                {text}
                {status.state === 'error' && status.message ? ` ${status.message}` : ''}
              </p>
            </div>
          </div>
          <div className="input-with-btn">
            {status.state === 'ready' || status.state === 'available' ? (
              <button className="btn btn-primary" onClick={() => void useUpdates.getState().install()}>
                {status.state === 'ready' ? 'Restart and update' : 'Open the release page'}
              </button>
            ) : (
              <button className="btn" disabled={busy || status.state === 'disabled' || status.state === 'downloading'} onClick={() => void useUpdates.getState().check()}>
                {busy ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />} Check for updates
              </button>
            )}
          </div>
          <Toggle
            label="Check for updates automatically"
            hint="At start and every 6 hours. On Windows and Linux new versions download in the background."
            checked={s.autoUpdate}
            onChange={(v) => save({ autoUpdate: v })}
          />
        </>
      )}
    </div>
  );
}

const PROXY_MODES = [
  ['none', 'No proxy'],
  ['system', 'System proxy'],
  ['manual', 'Manual'],
] as const;

/** Proxy: off, the OS's settings, or a proxy URL. "Manual" is only saved once a valid URL is entered. */
function ProxyFields({ s }: { s: SettingsT }) {
  const [mode, setMode] = useState(s.proxyMode);
  const [url, setUrl] = useState(s.proxyUrl);
  const [bypass, setBypass] = useState(s.proxyBypass.join(', '));
  const valid = isProxyUrl(url);
  const pick = (m: SettingsT['proxyMode']) => {
    setMode(m);
    if (m !== 'manual' || valid) save(m === 'manual' ? { proxyMode: m, proxyUrl: url.trim() } : { proxyMode: m });
  };
  const commitUrl = () => {
    if (valid && (url.trim() !== s.proxyUrl || s.proxyMode !== 'manual')) save({ proxyMode: 'manual', proxyUrl: url.trim() });
  };
  return (
    <>
      <h3 className="settings-subhead">Proxy</h3>
      <Field label="Connect through" hint={mode === 'system' ? 'Uses the proxy set in your operating system. Automatic setup scripts (PAC files) are not supported.' : undefined}>
        <div className="segmented">
          {PROXY_MODES.map(([m, label]) => (
            <button key={m} className={mode === m ? 'on' : ''} aria-pressed={mode === m} onClick={() => pick(m)}>
              {label}
            </button>
          ))}
        </div>
      </Field>
      {mode === 'manual' && (
        <Field label="Proxy address" hint={url.trim() && !valid ? 'Use http://host:port or socks5://host:port' : 'HTTP or SOCKS5. Add user:password@ before the host if the proxy needs a login.'}>
          <input
            className={`input mono-sm${url.trim() && !valid ? ' invalid' : ''}`}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={commitUrl}
            onKeyDown={(e) => e.key === 'Enter' && commitUrl()}
            placeholder="socks5://127.0.0.1:1080"
            spellCheck={false}
          />
        </Field>
      )}
      {mode !== 'none' && (
        <Field label="Don't use the proxy for" hint="Comma-separated host names; .example.com covers its subdomains; <local> covers names without a dot.">
          <input
            className="input mono-sm"
            value={bypass}
            onChange={(e) => setBypass(e.target.value)}
            onBlur={() => save({ proxyBypass: bypass.split(',').map((x) => x.trim()).filter(Boolean) })}
            spellCheck={false}
          />
        </Field>
      )}
    </>
  );
}

function isProxyUrl(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `http://${t}`);
    return ['http:', 'https:', 'socks:', 'socks5:', 'socks5h:'].includes(u.protocol) && !!u.hostname;
  } catch {
    return false;
  }
}

function AfterSection({ s }: { s: SettingsT }) {
  const electron = getPlatform().kind === 'electron';
  const windows = getPlatform().os === 'win32';
  const actions = (['nothing', 'quit', 'sleep', 'hibernate', 'shutdown'] as const).filter((a) => a !== 'quit' || electron);
  return (
    <div className="settings-section">
      <h3>After download</h3>
      <Field label="When all downloads finish" hint="Runs once after a one-minute warning you can cancel, then goes back to “Do nothing”. Also in the status bar.">
        <div className="segmented">
          {actions.map((a) => (
            <button key={a} className={s.whenDone === a ? 'on' : ''} aria-pressed={s.whenDone === a} onClick={() => save({ whenDone: a })}>
              {WHEN_DONE_LABEL[a]}
            </button>
          ))}
        </div>
      </Field>
      <Toggle
        label="Scan finished files for viruses"
        hint={windows ? 'Uses Microsoft Defender unless you set another scanner below.' : 'Set a scanner command below, for example clamscan.'}
        checked={s.scanAfterDownload}
        onChange={(v) => save({ scanAfterDownload: v })}
      />
      <TextField
        label="Scanner command"
        hint={<>Optional. <code>{'{file}'}</code> is replaced by the file's path. Exit code 0 means clean, 1 means a threat was found.</>}
        value={s.scanCommand}
        onSave={(v) => save({ scanCommand: v })}
        mono
      />
    </div>
  );
}

function SaveToSection({ s }: { s: SettingsT }) {
  const [dir, setDir] = useState(s.downloadDir);
  const browse = async () => {
    const picked = await getPlatform().chooseFolder(dir);
    if (picked) {
      setDir(picked);
      save({ downloadDir: picked });
    }
  };
  return (
    <div className="settings-section">
      <h3>Save to</h3>
      <Field label="Download folder">
        <div className="input-with-btn">
          <input className="input" value={dir} onChange={(e) => setDir(e.target.value)} onBlur={() => dir.trim() && dir !== s.downloadDir && save({ downloadDir: dir })} spellCheck={false} />
          {getPlatform().kind === 'electron' && (
            <button className="btn" onClick={browse}>
              <FolderOpen size={16} /> Browse
            </button>
          )}
        </div>
      </Field>
      <Toggle label="Sort files into category folders" hint="Video, Music, Documents, Compressed and Programs get their own sub-folder." checked={s.useCategoryFolders} onChange={(v) => save({ useCategoryFolders: v })} />
      <Field label="When the file already exists">
        <div className="segmented">
          <button className={s.duplicateAction === 'rename' ? 'on' : ''} onClick={() => save({ duplicateAction: 'rename' })}>
            Rename (file (1).zip)
          </button>
          <button className={s.duplicateAction === 'overwrite' ? 'on' : ''} onClick={() => save({ duplicateAction: 'overwrite' })}>
            Overwrite
          </button>
        </div>
      </Field>
    </div>
  );
}

const PRESETS = [256 * 1024, 512 * 1024, 1024 ** 2, 2 * 1024 ** 2, 5 * 1024 ** 2, 10 * 1024 ** 2];

function SpeedSection({ s }: { s: SettingsT }) {
  const [text, setText] = useState(s.speedLimit ? String(Math.round(s.speedLimit / 1024)) : '');
  const parsed = text.trim() ? parseRate(text) : 0;
  const commit = () => {
    if (parsed !== null && parsed !== s.speedLimit) save({ speedLimit: parsed, speedLimitEnabled: parsed > 0 ? true : s.speedLimitEnabled });
  };
  return (
    <div className="settings-section">
      <h3>Speed limiter</h3>
      <Toggle label="Limit the total download speed" hint="Shared by every running download. Toggle it from the status bar too." checked={s.speedLimitEnabled} onChange={(v) => save({ speedLimitEnabled: v })} />
      <Field label="Maximum speed (KB/s)" hint={parsed === null ? 'Enter a number, e.g. 800 or 2 MB' : parsed ? formatSpeed(parsed) : 'Not set'}>
        <input className={`input narrow${parsed === null ? ' invalid' : ''}`} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} placeholder="e.g. 1024" />
      </Field>
      <div className="presets">
        {PRESETS.map((p) => (
          <button
            key={p}
            className={`chip${s.speedLimit === p ? ' on' : ''}`}
            onClick={() => {
              setText(String(p / 1024));
              save({ speedLimit: p, speedLimitEnabled: true });
            }}
          >
            {formatSpeed(p)}
          </button>
        ))}
      </div>
    </div>
  );
}
