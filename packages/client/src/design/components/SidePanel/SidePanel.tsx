import type { HTMLAttributes, ReactNode } from "react";
import "./SidePanel.css";

function classes(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(" ");
}

export interface SidePanelProps extends HTMLAttributes<HTMLElement> {
  label: string;
  side?: "start" | "end";
  width?: "default" | "fill";
}

export function SidePanel({
  label,
  side = "end",
  width = "default",
  className,
  children,
  ...props
}: SidePanelProps) {
  return (
    <aside
      {...props}
      className={classes("side-panel", className)}
      data-side={side}
      data-width={width}
      aria-label={label}
    >
      {children}
    </aside>
  );
}

export function SidePanelHeader({
  title,
  actions,
  className,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  title: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div {...props} className={classes("side-panel__header", className)}>
      <strong>{title}</strong>
      {actions && <div className="side-panel__header-actions">{actions}</div>}
    </div>
  );
}

export function SidePanelBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={classes("side-panel__body", className)} />;
}

export function SidePanelEmpty({
  icon,
  title,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { icon?: ReactNode; title: ReactNode }) {
  return (
    <div {...props} className={classes("side-panel__empty", className)}>
      {icon && <span className="side-panel__empty-icon">{icon}</span>}
      <h2>{title}</h2>
      {children && <div>{children}</div>}
    </div>
  );
}
