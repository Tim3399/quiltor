import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

export function Popover({ anchorRef, open, onClose, children, label }: { anchorRef: RefObject<HTMLElement | null>; open: boolean; onClose: () => void; children: ReactNode; label?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !panel.current) return;
    const anchor = anchorRef.current.getBoundingClientRect(), box = panel.current.getBoundingClientRect(), gap = 6;
    setPosition({ left: Math.max(12, Math.min(anchor.left, innerWidth - box.width - 12)), top: anchor.bottom + gap + box.height <= innerHeight ? anchor.bottom + gap : Math.max(12, anchor.top - box.height - gap) });
  }, [open, anchorRef]);
  useEffect(() => {
    if (!open) return;
    const trigger = anchorRef.current;
    const pointer = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node) && !trigger?.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    const close = () => onClose();
    document.addEventListener('pointerdown', pointer); document.addEventListener('keydown', key); window.addEventListener('resize', close); window.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('pointerdown', pointer); document.removeEventListener('keydown', key); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); trigger?.focus(); };
  }, [open, onClose, anchorRef]);
  if (!open) return null;
  return <div ref={panel} className="ui-popover material-popover" role="dialog" aria-label={label} style={position}>{children}</div>;
}
