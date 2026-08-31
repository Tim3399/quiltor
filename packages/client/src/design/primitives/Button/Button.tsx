import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";
import "./Button.css";

export type ActionAppearance = "primary" | "secondary" | "ghost";
export type ActionTone = "neutral" | "danger";
export type ActionSize = "compact" | "regular" | "touch";
export type ActionIconPosition = "start" | "end";
export type ActionLabelOverflow = "truncate" | "visible";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  appearance?: ActionAppearance;
  tone?: ActionTone;
  size?: ActionSize;
  loading?: boolean;
  loadingLabel?: string;
  icon?: ReactNode;
  iconPosition?: ActionIconPosition;
  labelOverflow?: ActionLabelOverflow;
}

function classNames(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(" ");
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    appearance = "secondary",
    tone = "neutral",
    size = "regular",
    loading = false,
    loadingLabel,
    icon,
    iconPosition = "start",
    labelOverflow = "truncate",
    className,
    disabled = false,
    type = "button",
    children,
    "aria-label": ariaLabel,
    "aria-busy": ariaBusy,
    ...props
  },
  ref,
) {
  const renderedIcon = loading ? (
    <span className="ui-button__spinner" aria-hidden="true" />
  ) : icon ? (
    <span className="ui-button__icon" aria-hidden="true">
      {icon}
    </span>
  ) : null;

  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={classNames(
        "ui-button",
        `ui-button--${appearance}`,
        `ui-button--${tone}`,
        `ui-button--${size}`,
        loading && "ui-button--loading",
        className,
      )}
      data-appearance={appearance}
      data-tone={tone}
      data-size={size}
      data-loading={loading || undefined}
      data-label-overflow={labelOverflow}
      disabled={disabled || loading}
      aria-busy={loading ? true : ariaBusy}
      aria-label={loading && loadingLabel ? loadingLabel : ariaLabel}
    >
      {iconPosition === "start" && renderedIcon}
      <span className="ui-button__label">{children}</span>
      {iconPosition === "end" && renderedIcon}
    </button>
  );
});
