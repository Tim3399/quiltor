import { useId, useRef, type HTMLAttributes, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";
import { useOverlayFocus } from "../../internal/useOverlayFocus";
import { IconButton } from "../../primitives/IconButton";
import "./Dialog.css";

export type DialogSize = "regular" | "wide" | "focus";

export interface DialogProps {
  open?: boolean;
  title: ReactNode;
  closeLabel: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  size?: DialogSize;
  role?: "dialog" | "alertdialog";
  describedById?: string;
  className?: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

function classNames(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(" ");
}

export function Dialog({
  open = true,
  title,
  closeLabel,
  children,
  footer,
  onClose,
  size = "regular",
  role = "dialog",
  describedById,
  className,
  returnFocusRef,
}: DialogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useOverlayFocus(containerRef, open, onClose, returnFocusRef);

  if (!open) return null;

  return (
    <div
      className={`ui-dialog-backdrop ui-dialog-backdrop--${size}`}
      onPointerDown={(event) => event.target === event.currentTarget && onClose()}
    >
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is restricted to dialog roles. */}
      <div
        ref={containerRef}
        className={classNames("ui-dialog", `ui-dialog--${size}`, className)}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedById}
        tabIndex={-1}
      >
        <header className="ui-dialog__header">
          <h2 id={titleId} className="ui-dialog__title">
            {title}
          </h2>
          <IconButton
            className="ui-dialog__close"
            label={closeLabel}
            icon={<X />}
            onClick={onClose}
          />
        </header>
        <div className="ui-dialog__content">{children}</div>
        {footer !== undefined && <DialogFooter>{footer}</DialogFooter>}
      </div>
    </div>
  );
}

export interface DialogFooterProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function DialogFooter({ children, className, ...props }: DialogFooterProps) {
  return (
    <div {...props} className={classNames("ui-dialog__footer", className)}>
      {children}
    </div>
  );
}
