import type { HTMLAttributes, ReactNode } from "react";
import "./EmptyState.css";

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
  size?: "compact" | "regular";
  headingLevel?: 2 | 3;
}

export function EmptyState({
  icon,
  title,
  actions,
  size = "regular",
  headingLevel = 2,
  className = "",
  children,
  ...props
}: EmptyStateProps) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <div
      {...props}
      className={`empty-state-component empty-state-component--${size} ${className}`.trim()}
      data-size={size}
    >
      {icon && (
        <span className="empty-state-component__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <Heading>{title}</Heading>
      {children && <div className="empty-state-component__copy">{children}</div>}
      {actions && <div className="empty-state-component__actions">{actions}</div>}
    </div>
  );
}
