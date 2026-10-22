import { AlertTriangle, CheckCircle2, FolderOpen, Info, SquareArrowOutUpRight, X, XCircle } from 'lucide-react';
import { api } from '../../api/client';
import { attempt } from '../../app/commands';
import { useDownloads } from '../../store/downloads';
import { useUi } from '../../store/ui';

const ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle };

/** Bottom-right notifications; a finished download offers Open / Open folder, like IDM's completion dialog. */
export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const items = useDownloads((s) => s.items);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICONS[t.level];
        const done = t.downloadId && items[t.downloadId]?.status === 'completed';
        return (
          <div key={t.id} className={`toast toast-${t.level}`}>
            <Icon size={16} className="toast-icon" />
            <div className="toast-body">
              <div className="toast-text">{t.text}</div>
              {t.detail && <div className="toast-detail">{t.detail}</div>}
              {done && (
                <div className="toast-actions">
                  <button className="btn btn-xs" onClick={() => attempt(() => api.open(t.downloadId!, false), 'Could not open the file')}>
                    <SquareArrowOutUpRight size={14} /> Open
                  </button>
                  <button className="btn btn-xs" onClick={() => attempt(() => api.open(t.downloadId!, true), 'Could not open the folder')}>
                    <FolderOpen size={14} /> Open folder
                  </button>
                </div>
              )}
            </div>
            <button className="icon-btn xs" aria-label="Dismiss" onClick={() => useUi.getState().dismissToast(t.id)}>
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
