import type { HTMLAttributes, ReactNode } from "react";
import { IconButton } from "../../primitives/IconButton";
import type { AlertTone } from "../Alert";
import "./Toast.css";

type DismissibleToast =
  | { onDismiss?: undefined; dismissLabel?: never }
  | { onDismiss: () => void; dismissLabel: string };

export type ToastProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> &
  DismissibleToast & {
    tone?: AlertTone;
    title?: ReactNode;
    action?: ReactNode;
    live?: "polite" | "assertive";
  };

export function Toast({
  tone = "info",
  title,
  action,
  live = tone === "danger" ? "assertive" : "polite",
  onDismiss,
  dismissLabel,
  className = "",
  children,
  ...props
}: ToastProps) {
  return (
    <div
      {...props}
      className={`design-toast design-toast--${tone} ${className}`.trim()}
      data-tone={tone}
      role={live === "assertive" ? "alert" : "status"}
      aria-live={live}
    >
      <div className="design-toast__copy">
        {title && <strong>{title}</strong>}
        <div>{children}</div>
      </div>
      {action && <div className="design-toast__action">{action}</div>}
      {onDismiss && dismissLabel && (
        <IconButton
          label={dismissLabel}
          icon={<span aria-hidden="true">×</span>}
          onClick={onDismiss}
          size="touch"
        />
      )}
    </div>
  );
}

export function ToastRegion({ label, ...props }: HTMLAttributes<HTMLElement> & { label: string }) {
  return (
    <section
      {...props}
      className={`design-toast-region ${props.className ?? ""}`.trim()}
      aria-label={label}
    />
  );
}
