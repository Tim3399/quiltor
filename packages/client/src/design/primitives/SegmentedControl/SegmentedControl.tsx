import { Lock } from "lucide-react";
import { type HTMLAttributes, type KeyboardEvent, type ReactNode, useRef } from "react";
import { Tooltip } from "../../components/Tooltip";
import "./SegmentedControl.css";

export type Segment<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
  /**
   * Why the segment is unavailable, shown as a tooltip. A disabled segment with a hint is only
   * `aria-disabled`: it still receives hover and focus so its reason can be reached, but it
   * cannot be chosen. A small lock marks it at a glance and is where the hint docks.
   */
  hint?: string;
  /** The hint's element id, for a caller that also describes the whole group with it. */
  hintId?: string;
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
    // A segment locked with a hint takes focus, so its reason is reachable, but is not chosen.
    if (buttons[index].getAttribute("aria-disabled") !== "true") buttons[index].click();
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
      {options.map((option): ReactNode => {
        const locked = Boolean(option.disabled && option.hint);
        const segment = (extra: object = {}) => (
          // biome-ignore lint/a11y/useSemanticElements: A segmented control is a roving-focus ARIA radio group whose visible segments are buttons.
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            tabIndex={value === option.value ? 0 : -1}
            disabled={option.disabled && !locked}
            aria-disabled={locked || undefined}
            onClick={() => {
              if (!locked) onChange(option.value);
            }}
            {...extra}
          >
            {locked && (
              <span className="ui-segmented__lock" data-tooltip-anchor aria-hidden="true">
                <Lock />
              </span>
            )}
            {option.label}
          </button>
        );
        if (!option.hint) return segment();
        return (
          <Tooltip key={option.value} id={option.hintId} content={option.hint}>
            {(trigger) => segment(trigger)}
          </Tooltip>
        );
      })}
    </div>
  );
}
