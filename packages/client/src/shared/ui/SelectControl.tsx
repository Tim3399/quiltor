import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Popover } from "./Popover";

export interface SelectControlOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export function SelectControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: SelectControlOption<T>[];
  onChange: (value: T) => void;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      const current = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
      const first = listRef.current?.querySelector<HTMLElement>('[role="option"]:not([disabled])');
      (current ?? first)?.focus();
    });
  }, [open]);

  const choose = (option: SelectControlOption<T>) => {
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
      ...(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]:not([disabled])') ?? []),
    ];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
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
        className="ui-select-control"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onButtonKeyDown}
      >
        <span>{selected?.label ?? value}</span>
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
              disabled={option.disabled}
              tabIndex={-1}
              onClick={() => choose(option)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}
