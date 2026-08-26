import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { IconButton } from "../../primitives/IconButton";
import "./Chip.css";

export type ChipTone = "neutral" | "accent" | "danger";

function classes(tone: ChipTone, className?: string) {
  return `design-chip design-chip--${tone} ${className ?? ""}`.trim();
}

export interface ChipProps extends HTMLAttributes<HTMLLIElement> {
  tone?: ChipTone;
}

export function Chip({ tone = "neutral", className, ...props }: ChipProps) {
  return <li {...props} className={classes(tone, className)} data-tone={tone} />;
}

export interface ChipActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ChipTone;
  selected?: boolean;
}

export function ChipAction({
  tone = "neutral",
  selected = false,
  className,
  type = "button",
  children,
  ...props
}: ChipActionProps) {
  return (
    <li className="design-chip-item">
      <button
        {...props}
        type={type}
        className={classes(tone, className)}
        data-tone={tone}
        aria-pressed={selected}
      >
        {children}
      </button>
    </li>
  );
}

export interface RemovableChipProps extends Omit<HTMLAttributes<HTMLLIElement>, "children"> {
  children: ReactNode;
  removeLabel: string;
  onRemove: () => void;
  tone?: ChipTone;
  disabled?: boolean;
}

export function RemovableChip({
  children,
  removeLabel,
  onRemove,
  tone = "neutral",
  disabled = false,
  className,
  ...props
}: RemovableChipProps) {
  return (
    <li
      {...props}
      className={`${classes(tone, className)} design-chip--removable`}
      data-tone={tone}
    >
      <span className="design-chip__label">{children}</span>
      <IconButton
        label={removeLabel}
        icon={<span aria-hidden="true">×</span>}
        onClick={onRemove}
        disabled={disabled}
        size="compact"
      />
    </li>
  );
}

export function ChipList({
  label,
  className = "",
  ...props
}: HTMLAttributes<HTMLUListElement> & { label: string }) {
  return <ul {...props} className={`design-chip-list ${className}`.trim()} aria-label={label} />;
}
