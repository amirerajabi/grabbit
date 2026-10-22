interface SplitterProps {
  direction: 'vertical' | 'horizontal';
  ariaLabel: string;
  onDragStart?: () => void;
  /** Pixels moved since the drag started (right/down positive). */
  onDrag: (delta: number) => void;
  onDoubleClick?: () => void;
}

export function Splitter({ direction, ariaLabel, onDragStart, onDrag, onDoubleClick }: SplitterProps) {
  const vertical = direction === 'vertical';
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const start = vertical ? e.clientX : e.clientY;
    onDragStart?.();
    document.body.classList.add(vertical ? 'resizing-col' : 'resizing-row');
    const move = (m: MouseEvent) => onDrag((vertical ? m.clientX : m.clientY) - start);
    const up = () => {
      document.body.classList.remove('resizing-col', 'resizing-row');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  return <div className={`splitter splitter-${direction}`} role="separator" aria-label={ariaLabel} aria-orientation={vertical ? 'vertical' : 'horizontal'} onMouseDown={onMouseDown} onDoubleClick={onDoubleClick} />;
}
