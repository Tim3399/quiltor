import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { Dialog } from "./Dialog";

export type CommandPaletteItem = {
  id: string;
  label: string;
  detail?: string;
  keywords?: string[];
  icon?: ReactNode;
  requiresQuery?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

export function CommandPalette({
  open,
  label,
  inputLabel = label,
  placeholder,
  emptyLabel,
  items,
  onClose,
  onQueryChange,
}: {
  open: boolean;
  label: string;
  inputLabel?: string;
  placeholder: string;
  emptyLabel: string;
  items: CommandPaletteItem[];
  onClose: () => void;
  onQueryChange?: (query: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const optionPrefix = useId();
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);
  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return items.filter(
      (item) =>
        (!item.requiresQuery || needle) &&
        (!needle ||
          [item.label, item.detail, ...(item.keywords || [])].some((value) =>
            value?.toLocaleLowerCase().includes(needle),
          )),
    );
  }, [items, query]);
  if (!open) return null;
  const select = (item: CommandPaletteItem | undefined) => {
    if (item && !item.disabled) {
      onClose();
      item.onSelect();
    }
  };
  return (
    <Dialog title={label} onClose={onClose} wide>
      <label className="ui-command-palette__search">
        <Search aria-hidden="true" />
        <span className="sr-only">{inputLabel}</span>
        <input
          data-autofocus
          role="combobox"
          aria-expanded="true"
          aria-controls={`${optionPrefix}-results`}
          aria-activedescendant={
            results[active] ? `${optionPrefix}-${results[active].id}` : undefined
          }
          value={query}
          placeholder={placeholder}
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            onQueryChange?.(next);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (results.length)
                setActive(
                  (index) =>
                    (index + (event.key === "ArrowDown" ? 1 : -1) + results.length) %
                    results.length,
                );
            } else if (event.key === "Enter") {
              event.preventDefault();
              select(results[active]);
            }
          }}
        />
      </label>
      <div
        id={`${optionPrefix}-results`}
        className="ui-command-palette__results"
        role="listbox"
        aria-label={label}
      >
        {results.map((item, index) => (
          <button
            id={`${optionPrefix}-${item.id}`}
            key={item.id}
            type="button"
            role="option"
            aria-selected={index === active}
            disabled={item.disabled}
            onPointerMove={() => setActive(index)}
            onFocus={() => setActive(index)}
            onClick={() => select(item)}
          >
            {item.icon}
            <span>
              <strong>{highlightQuery(item.label, query)}</strong>
              {item.detail && <small>{highlightQuery(item.detail, query)}</small>}
            </span>
          </button>
        ))}
        {!results.length && <p>{emptyLabel}</p>}
      </div>
    </Dialog>
  );
}

function highlightQuery(value: string, query: string) {
  const needle = query.trim();
  if (!needle) return value;
  const expression = new RegExp(`(${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "giu");
  return value
    .split(expression)
    .map((part, index) => (index % 2 ? <mark key={`${part}-${index}`}>{part}</mark> : part));
}
