import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { ActionAppearance, ActionSize, ActionTone } from "../Button";
import "./IconButton.css";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> {
  label: string;
  icon: ReactNode;
  appearance?: ActionAppearance;
  tone?: ActionTone;
  size?: ActionSize;
  loading?: boolean;
  loadingLabel?: string;
}

function classNames(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(" ");
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    icon,
    appearance = "ghost",
    tone = "neutral",
    size = "compact",
    loading = false,
    loadingLabel,
    className,
    disabled = false,
    type = "button",
    "aria-busy": ariaBusy,
    ...props
  },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={classNames(
        "icon-button",
        `icon-button--${appearance}`,
        `icon-button--${tone}`,
        `icon-button--${size}`,
        loading && "icon-button--loading",
        className,
      )}
      data-appearance={appearance}
      data-tone={tone}
      data-size={size}
      data-loading={loading || undefined}
      disabled={disabled || loading}
      aria-busy={loading ? true : ariaBusy}
      aria-label={loading && loadingLabel ? loadingLabel : label}
    >
      <span className="icon-button__icon" aria-hidden="true">
        {loading ? <span className="icon-button__spinner" /> : icon}
      </span>
    </button>
  );
});
