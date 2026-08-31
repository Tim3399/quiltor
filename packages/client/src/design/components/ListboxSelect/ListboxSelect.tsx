import { ChevronDown } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Popover } from "../Popover";
import "./ListboxSelect.css";

export interface ListboxSelectOption<T extends string> {
  value: T;
  label: string;
  /** Decorative context such as a color swatch. Callers own its accessible semantics. */
  leading?: ReactNode;
  disabled?: boolean;
}

export interface ListboxSelectProps<T extends string> {
  label: string;
  value: T;
  options: readonly ListboxSelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  size?: "compact" | "regular" | "touch";
  className?: string;
}

/** A button-triggered listbox for compact layouts where a native Select is not suitable. */
export function ListboxSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  size = "regular",
  className = "",
}: ListboxSelectProps<T>) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];
  const focusOption =
    options.find((option) => option.value === value && !option.disabled) ??
    options.find((option) => !option.disabled);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const current = listRef.current?.querySelector<HTMLElement>(
        '[aria-selected="true"]:not(:disabled)',
      );
      const first = listRef.current?.querySelector<HTMLElement>('[role="option"]:not(:disabled)');
      (current ?? first)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const choose = (option: ListboxSelectOption<T>) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
  };

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
    }
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [
      ...(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]:not(:disabled)') ?? []),
    ];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && items.length) {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      items[(index + offset + items.length) % items.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const search = event.key.toLocaleLowerCase();
      const start = Math.max(index + 1, 0);
      const ordered = [...items.slice(start), ...items.slice(0, start)];
      ordered
        .find((item) => item.textContent?.trim().toLocaleLowerCase().startsWith(search))
        ?.focus();
    }
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={`ui-select-control ${className}`.trim()}
        data-size={size}
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onButtonKeyDown}
      >
        <span className="ui-select-option__content">
          {selected?.leading}
          <span className="ui-select-option__label">{selected?.label ?? value}</span>
        </span>
        <ChevronDown aria-hidden="true" />
      </button>
      <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} label={label}>
        <div
          ref={listRef}
          id={listboxId}
          className="ui-select-listbox"
          role="listbox"
          aria-label={label}
          onKeyDown={onListKeyDown}
        >
          {options.map((option) => (
            <button
              type="button"
              role="option"
              key={option.value}
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              disabled={option.disabled}
              tabIndex={-1}
              data-autofocus={option.value === focusOption?.value || undefined}
              onClick={() => choose(option)}
            >
              <span className="ui-select-option__content">
                {option.leading}
                <span className="ui-select-option__label">{option.label}</span>
              </span>
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}
