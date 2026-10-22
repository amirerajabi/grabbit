import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { useUi } from '../../store/ui';
import { Dialog } from './Dialog';

export function ConfirmDialog() {
  const c = useUi((s) => s.confirm);
  const [checked, setChecked] = useState(false);
  if (!c) return null;
  const close = (ok: boolean) => {
    useUi.getState().resolveConfirm(ok, checked);
    setChecked(false);
  };
  return (
    <Dialog
      title={c.title}
      icon={c.danger ? <AlertTriangle size={18} className="text-danger" /> : undefined}
      width={440}
      onClose={() => close(false)}
      footer={
        <>
          <button className="btn" onClick={() => close(false)} autoFocus>
            Cancel
          </button>
          <button className={`btn ${c.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)}>
            {c.confirmLabel}
          </button>
        </>
      }
    >
      <p className="confirm-message">{c.message}</p>
      {c.checkbox && (
        <label className="check confirm-check">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          {c.checkbox}
        </label>
      )}
    </Dialog>
  );
}
