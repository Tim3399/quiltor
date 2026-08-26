import { X } from "lucide-react";
import { forwardRef, type HTMLAttributes, type ReactNode, useRef } from "react";
import { useOverlayFocus } from "../../internal/useOverlayFocus";
import { IconButton } from "../../primitives/IconButton";
import "./Sheet.css";

export interface SheetProps {
  open: boolean;
  label: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}

/** A modal side sheet which becomes a bottom sheet on compact viewports. */
export function Sheet({
  open,
  label,
  onClose,
  children,
  wide = false,
  className = "",
}: SheetProps) {
  const panel = useRef<HTMLElement>(null);
  useOverlayFocus(panel, open, onClose);
  if (!open) return null;
  return (
    <div
      className="ui-sheet-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={panel}
        className={`ui-sheet material-sheet ${wide ? "ui-sheet--wide" : ""} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        {children}
      </aside>
    </div>
  );
}

export interface SheetHeaderProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: ReactNode;
  closeLabel: string;
  onClose: () => void;
  actions?: ReactNode;
}

/** Standard sheet chrome with a visible heading and mandatory accessible close action. */
export const SheetHeader = forwardRef<HTMLElement, SheetHeaderProps>(function SheetHeader(
  { title, closeLabel, onClose, actions, className = "", ...props },
  ref,
) {
  return (
    <header {...props} ref={ref} className={`ui-sheet__header ${className}`.trim()}>
      <h2>{title}</h2>
      <div className="ui-sheet__header-actions">
        {actions}
        <IconButton label={closeLabel} icon={<X />} onClick={onClose} />
      </div>
    </header>
  );
});

export const SheetBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function SheetBody({ className = "", ...props }, ref) {
    return <div {...props} ref={ref} className={`ui-sheet__body ${className}`.trim()} />;
  },
);
