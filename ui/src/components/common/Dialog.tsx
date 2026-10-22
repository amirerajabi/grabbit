import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

interface DialogProps {
  title: ReactNode;
  icon?: ReactNode;
  width?: number;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Enter in a text field submits (the primary action). */
  onSubmit?: () => void;
}

/** Modal dialog: overlay click and Escape close it, focus is trapped inside and restored on close. */
export function Dialog({ title, icon, width = 520, onClose, footer, children, className, onSubmit }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[autofocus], input:not([type=checkbox]):not([disabled]), textarea, select, button.btn-primary');
    (first ?? el)?.focus();
    return () => prev?.focus?.();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeRef.current();
      return;
    }
    if (e.key === 'Enter' && onSubmit && (e.target as HTMLElement).tagName === 'INPUT' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSubmit();
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const nodes = [...ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [tabindex="0"]')];
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`dialog ${className ?? ''}`} style={{ width }} role="dialog" aria-modal="true" tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="dialog-header">
          <div className="dialog-title">
            {icon}
            <span>{title}</span>
          </div>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <X size={16} />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, inline }: { label: string; hint?: ReactNode; children: ReactNode; inline?: boolean }) {
  return (
    <label className={`field${inline ? ' field-inline' : ''}`}>
      <span className="field-label">{label}</span>
      <span className="field-control">{children}</span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
