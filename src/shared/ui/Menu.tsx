import { Children, cloneElement, isValidElement, useEffect, useRef, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';

export function Menu({ label, children, onClose, autoFocus = true }: { label: string; children: ReactNode; onClose: () => void; autoFocus?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { if (autoFocus) root.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus(); }, [autoFocus]);
  const onKeyDown = (event: KeyboardEvent) => {
    const items = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') || [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
    else if (event.key === 'Home') { event.preventDefault(); items[0]?.focus(); }
    else if (event.key === 'End') { event.preventDefault(); items.at(-1)?.focus(); }
  };
  return <div ref={root} className="ui-menu" role="menu" aria-label={label} onKeyDown={onKeyDown}>{children}</div>;
}

export function MenuItem({ children, onSelect, disabled = false }: { children: ReactNode; onSelect: () => void; disabled?: boolean }) {
  return <button type="button" role="menuitem" disabled={disabled} tabIndex={-1} onClick={() => { if (!disabled) onSelect(); }}>{children}</button>;
}

export function MenuSeparator() { return <div className="ui-menu__separator" role="separator" />; }

export function ContextMenu({ children, ...props }: Parameters<typeof Menu>[0]) {
  return <Menu {...props}>{Children.map(children, child => isValidElement(child) ? cloneElement(child as ReactElement) : child)}</Menu>;
}
