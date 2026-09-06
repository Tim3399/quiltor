import type { HTMLAttributes, ReactNode } from "react";
import "./StatusBar.css";

export type StatusBarTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface StatusBarProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /** Names the region for assistive technology. */
  label: string;
  /** What is open: counts, position, context. */
  start?: ReactNode;
  /** What the application is doing: saving, thinking, waiting. */
  end?: ReactNode;
}

function classes(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(" ");
}

/**
 * The persistent bottom line of the application.
 *
 * It answers two questions and nothing else: what is open, and what is the application
 * doing about it. Both sides stay legible while a writer works, so nothing in here may
 * take focus, move, or demand a decision -- an action belongs in a toolbar or a dialog.
 */
export function StatusBar({ label, start, end, className, ...props }: StatusBarProps) {
  return (
    <footer
      {...props}
      // The landmark is spelled out rather than left to the parser: a footer only maps to
      // contentinfo while it sits outside sectioning content, and the shell must not lose
      // its status region if the frame is ever nested.
      role="contentinfo"
      className={classes("status-bar", className)}
      aria-label={label}
    >
      <div className="status-bar__group">{start}</div>
      <div className="status-bar__group status-bar__group--end">{end}</div>
    </footer>
  );
}

export interface StatusBarItemProps extends HTMLAttributes<HTMLSpanElement> {
  icon?: ReactNode;
  tone?: StatusBarTone;
}

export function StatusBarItem({
  icon,
  tone = "neutral",
  className,
  children,
  ...props
}: StatusBarItemProps) {
  return (
    <span {...props} className={classes("status-bar__item", className)} data-tone={tone}>
      {icon && (
        <span className="status-bar__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="status-bar__label">{children}</span>
    </span>
  );
}
