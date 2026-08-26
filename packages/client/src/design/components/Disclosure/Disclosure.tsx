import type { DetailsHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import "./Disclosure.css";

export interface DisclosureProps extends DetailsHTMLAttributes<HTMLDetailsElement> {
  summary: ReactNode;
  summaryProps?: Omit<HTMLAttributes<HTMLElement>, "children">;
}

export function Disclosure({
  summary,
  summaryProps,
  className = "",
  children,
  ...props
}: DisclosureProps) {
  return (
    <details {...props} className={`design-disclosure ${className}`.trim()}>
      <summary
        {...summaryProps}
        className={`design-disclosure__summary ${summaryProps?.className ?? ""}`.trim()}
      >
        <span className="design-disclosure__label">{summary}</span>
        <span className="design-disclosure__chevron" aria-hidden="true">
          ›
        </span>
      </summary>
      <div className="design-disclosure__content">{children}</div>
    </details>
  );
}
