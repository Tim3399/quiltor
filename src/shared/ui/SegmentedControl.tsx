import { useRef, type KeyboardEvent } from "react";

export type Segment<T extends string> = { value: T; label: string; disabled?: boolean };

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Segment<T>[];
  onChange: (value: T) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const move = (event: KeyboardEvent, direction: number | "first" | "last") => {
    const buttons = [
      ...(root.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)') || []),
    ];
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const index =
      direction === "first"
        ? 0
        : direction === "last"
          ? buttons.length - 1
          : (current + direction + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[index].focus();
    buttons[index].click();
  };
  return (
    <div
      ref={root}
      className="ui-segmented"
      role="radiogroup"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowDown") move(event, 1);
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp") move(event, -1);
        else if (event.key === "Home") move(event, "first");
        else if (event.key === "End") move(event, "last");
      }}
    >
      {options.map((option) => (
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
