import type { HTMLAttributes, ReactNode } from "react";
import "./Alert.css";

export type AlertTone = "info" | "success" | "warning" | "danger";

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  tone?: AlertTone;
  title?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  role?: "alert" | "status";
}

export function Alert({
  tone = "info",
  title,
  icon,
  action,
  role = "alert",
  className = "",
  children,
  ...props
}: AlertProps) {
  return (
    <div
      {...props}
      className={`design-alert design-alert--${tone} ${className}`.trim()}
      data-tone={tone}
      role={role}
    >
      {icon && (
        <span className="design-alert__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="design-alert__copy">
        {title && <strong>{title}</strong>}
        <div>{children}</div>
      </div>
      {action && <div className="design-alert__action">{action}</div>}
    </div>
  );
}
