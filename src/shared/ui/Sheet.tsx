import { useRef, type ReactNode } from 'react';
import { useOverlayFocus } from './useOverlayFocus';

export function Sheet({ open, label, onClose, children }: { open: boolean; label: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  useOverlayFocus(panel, open, onClose);
  if (!open) return null;
  return <div className="ui-sheet-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}><aside ref={panel} className="ui-sheet material-sheet" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>{children}</aside></div>;
}
