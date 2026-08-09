import { useEffect, useRef, type ReactNode } from 'react';

export function Sheet({ open, label, onClose, children }: { open: boolean; label: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')];
      if (!items.length) return;
      const first = items[0], last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key); requestAnimationFrame(() => panel.current?.focus());
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return <div className="ui-sheet-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><aside ref={panel} className="ui-sheet material-sheet" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>{children}</aside></div>;
}
