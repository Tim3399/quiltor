import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '../../language';

export function Dialog({ title, children, onClose, wide = false }: {
  title: string; children: React.ReactNode; onClose: () => void; wide?: boolean;
}) {
  const { t } = useLanguage();
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    // Mount/unmount only: call sites typically pass a fresh inline onClose on every
    // render, and re-running this on [onClose] would re-capture document.activeElement
    // and re-focus the dialog box every time -- stealing focus from whatever the user
    // is typing inside the dialog whenever the parent re-renders for unrelated reasons.
    const previous = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key !== 'Tab' || !box.current) return;
      const focusable = [...box.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  return <div className="dialog-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <div className={`dialog ${wide ? 'dialog-wide' : ''}`} ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header><h2 id={titleId}>{title}</h2><button className="icon-button" onClick={onClose} aria-label={t('closeDialog')}><X /></button></header>
      <div className="dialog-content">{children}</div>
    </div>
  </div>;
}
