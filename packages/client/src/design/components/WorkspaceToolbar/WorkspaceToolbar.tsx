import type { FieldsetHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import "./WorkspaceToolbar.css";

function classes(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(" ");
}

export interface WorkspaceToolbarProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
}

export function WorkspaceToolbar({ label, className, children, ...props }: WorkspaceToolbarProps) {
  return (
    <div
      {...props}
      className={classes("workspace-toolbar", className)}
      role="toolbar"
      aria-label={label}
    >
      {children}
    </div>
  );
}

export function WorkspaceToolbarTitle({
  title,
  detail,
  className,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  title: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div {...props} className={classes("workspace-toolbar__title", className)}>
      <strong>{title}</strong>
      {detail && <span>{detail}</span>}
    </div>
  );
}

export function WorkspaceToolbarActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={classes("workspace-toolbar__actions", className)} />;
}

export function WorkspaceToolbarGroup({
  label,
  className,
  children,
  ...props
}: FieldsetHTMLAttributes<HTMLFieldSetElement> & { label?: string }) {
  return (
    <fieldset {...props} className={classes("workspace-toolbar__group", className)}>
      {label && <legend>{label}</legend>}
      {children}
    </fieldset>
  );
}
