import type { HTMLAttributes, ReactNode } from "react";
import "./PageState.css";

export interface PageStateProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  kind: "loading" | "error" | "empty";
  mark?: ReactNode;
  title?: ReactNode;
  actions?: ReactNode;
}

export function PageState({
  kind,
  mark,
  title,
  actions,
  className = "",
  children,
  ...props
}: PageStateProps) {
  return (
    <main
      {...props}
      className={`page-state page-state--${kind} ${className}`.trim()}
      data-kind={kind}
      aria-busy={kind === "loading" ? true : undefined}
    >
      {mark && <div className="page-state__mark">{mark}</div>}
      {title && <h1>{title}</h1>}
      {children && (
        <div
          className="page-state__copy"
          role={kind === "loading" ? "status" : kind === "error" ? "alert" : undefined}
        >
          {children}
        </div>
      )}
      {actions && <div className="page-state__actions">{actions}</div>}
    </main>
  );
}
