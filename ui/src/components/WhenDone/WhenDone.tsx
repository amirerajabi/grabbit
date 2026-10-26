import { Moon, Power, PowerOff, Timer, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { WhenDoneAction } from '../../../../shared/protocol';
import { api } from '../../api/client';
import { attempt } from '../../app/commands';
import { getPlatform } from '../../platform';
import { useEngine } from '../../store/engine';
import { Dialog } from '../common/Dialog';
import { showMenuBelow, type MenuItem } from '../common/Menu';

export const WHEN_DONE_LABEL: Record<WhenDoneAction, string> = {
  nothing: 'Do nothing',
  quit: 'Quit Grabbit',
  sleep: 'Sleep',
  hibernate: 'Hibernate',
  shutdown: 'Shut down',
};

/** Words for the countdown: "Shutting down in 42 s". */
const DOING: Record<WhenDoneAction, string> = { nothing: '', quit: 'Quitting Grabbit', sleep: 'Going to sleep', hibernate: 'Hibernating', shutdown: 'Shutting down' };

export function whenDoneMenu(current: WhenDoneAction): MenuItem[] {
  const desktop = getPlatform().kind === 'electron';
  const pick = (a: WhenDoneAction): MenuItem => ({
    label: WHEN_DONE_LABEL[a],
    checked: a === current,
    // Quit only makes sense for the desktop app; power actions run on the engine's machine either way.
    disabled: a === 'quit' && !desktop ? 'Only in the desktop app' : false,
    run: () => attempt(() => useEngine.getState().updateSettings({ whenDone: a })),
  });
  return [pick('nothing'), 'separator', pick('quit'), pick('sleep'), pick('hibernate'), pick('shutdown')];
}

/** Status bar item: what happens when every download has finished. Highlighted while it is armed. */
export function WhenDoneButton() {
  const action = useEngine((s) => s.settings?.whenDone ?? 'nothing');
  const armed = action !== 'nothing';
  const Icon = action === 'shutdown' ? PowerOff : action === 'sleep' || action === 'hibernate' ? Moon : action === 'quit' ? Power : Timer;
  return (
    <button
      className={`sb-item sb-button${armed ? ' sb-warn' : ''}`}
      title={armed ? `When all downloads finish: ${WHEN_DONE_LABEL[action].toLowerCase()} (once). Click to change.` : 'Choose what happens when all downloads finish'}
      onClick={(e) => showMenuBelow(e.currentTarget, whenDoneMenu(action))}
    >
      <Icon size={12} />
      {armed ? `When done: ${WHEN_DONE_LABEL[action]}` : 'When done'}
    </button>
  );
}

/** The last-minute warning before the action runs, with Cancel (which also turns the action off). */
export function WhenDoneCountdown() {
  const pending = useEngine((s) => s.whenDone);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!pending) return;
    getPlatform().bringToFront();
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [pending]);
  if (!pending) return null;
  const left = Math.max(0, Math.ceil((pending.at - now) / 1000));
  const cancel = () => void attempt(() => api.cancelWhenDone(), 'Could not cancel');
  return (
    <Dialog
      title="All downloads finished"
      icon={<PowerOff size={18} className="text-warning" />}
      width={420}
      onClose={cancel}
      footer={
        <button className="btn btn-primary" onClick={cancel} autoFocus>
          <X size={16} /> Cancel
        </button>
      }
    >
      <p className="countdown">
        {DOING[pending.action]} in <strong className="tabular">{left} s</strong>.
      </p>
      <p className="muted">This was set in the status bar's “When done” menu, for this time only.</p>
    </Dialog>
  );
}
