import { useId, useRef } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '../../language';
import { useOverlayFocus } from './useOverlayFocus';

export function Dialog({ title, children, onClose, wide = false }: {
  title: string; children: React.ReactNode; onClose: () => void; wide?: boolean;
}) {
  const { t } = useLanguage();
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useOverlayFocus(box, true, onClose);
  return <div className="dialog-backdrop" onPointerDown={event => event.target === event.currentTarget && onClose()}>
    <div className={`dialog ${wide ? 'dialog-wide' : ''}`} ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header><h2 id={titleId}>{title}</h2><button className="icon-button" onClick={onClose} aria-label={t('closeDialog')}><X /></button></header>
      <div className="dialog-content">{children}</div>
    </div>
  </div>;
}
