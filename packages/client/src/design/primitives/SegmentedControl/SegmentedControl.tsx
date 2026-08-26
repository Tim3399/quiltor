import { type HTMLAttributes, type KeyboardEvent, useRef } from "react";
import "./SegmentedControl.css";

export type Segment<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

export interface SegmentedControlProps<T extends string>
  extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  label: string;
  value: T;
  options: readonly Segment<T>[];
  onChange: (value: T) => void;
  size?: "compact" | "regular" | "touch";
}

/** A single-choice control with native radio-group keyboard behavior. */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  size = "regular",
  className = "",
  ...props
}: SegmentedControlProps<T>) {
  const root = useRef<HTMLDivElement>(null);
  const move = (event: KeyboardEvent, direction: number | "first" | "last") => {
    const buttons = [
      ...(root.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)') ?? []),
    ];
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const index =
      direction === "first"
        ? 0
        : direction === "last"
          ? buttons.length - 1
          : (Math.max(current, 0) + direction + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[index].focus();
    buttons[index].click();
  };
  return (
    <div
      {...props}
      ref={root}
      className={`ui-segmented ${className}`.trim()}
      data-size={size}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(event) => {
        props.onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") move(event, 1);
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp") move(event, -1);
        else if (event.key === "Home") move(event, "first");
        else if (event.key === "End") move(event, "last");
      }}
    >
      {options.map((option) => (
        // biome-ignore lint/a11y/useSemanticElements: A segmented control is a roving-focus ARIA radio group whose visible segments are buttons.
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
