import { Search } from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { Dialog } from "../../components/Dialog";
import "./CommandPalette.css";

export interface CommandPaletteItem {
  id: string;
  label: string;
  detail?: string;
  keywords?: string[];
  icon?: ReactNode;
  requiresQuery?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  label: string;
  closeLabel: string;
  inputLabel?: string;
  placeholder: string;
  emptyLabel: string;
  items: CommandPaletteItem[];
  onClose: () => void;
  onQueryChange?: (query: string) => void;
}

function firstEnabledIndex(items: CommandPaletteItem[]) {
  return items.findIndex((item) => !item.disabled);
}

function moveToEnabledItem(items: CommandPaletteItem[], active: number, direction: 1 | -1) {
  if (!items.length) return -1;
  for (let offset = 1; offset <= items.length; offset += 1) {
    const candidate = (active + direction * offset + items.length) % items.length;
    if (!items[candidate].disabled) return candidate;
  }
  return -1;
}

export function CommandPalette({
  open,
  label,
  closeLabel,
  inputLabel = label,
  placeholder,
  emptyLabel,
  items,
  onClose,
  onQueryChange,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const optionPrefix = useId();

  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return items.filter(
      (item) =>
        (!item.requiresQuery || needle) &&
        (!needle ||
          [item.label, item.detail, ...(item.keywords ?? [])].some((value) =>
            value?.toLocaleLowerCase().includes(needle),
          )),
    );
  }, [items, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(-1);
    }
  }, [open]);

  useEffect(() => {
    setActive((current) =>
      results[current] && !results[current].disabled ? current : firstEnabledIndex(results),
    );
  }, [results]);

  const select = (item: CommandPaletteItem | undefined) => {
    if (!item || item.disabled) return;
    onClose();
    item.onSelect();
  };

  const activeOptionId = active >= 0 ? `${optionPrefix}-option-${active}` : undefined;
  const hasResults = results.length > 0;

  useEffect(() => {
    if (!activeOptionId) return;
    document.getElementById(activeOptionId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeOptionId]);

  return (
    <Dialog open={open} title={label} closeLabel={closeLabel} onClose={onClose} size="wide">
      <label className="ui-command-palette__search">
        <Search className="ui-command-palette__search-icon" aria-hidden="true" />
        <span className="sr-only">{inputLabel}</span>
        <input
          className="ui-command-palette__input"
          data-autofocus
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={hasResults}
          aria-controls={hasResults ? `${optionPrefix}-results` : undefined}
          aria-activedescendant={activeOptionId}
          value={query}
          placeholder={placeholder}
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            onQueryChange?.(next);
            setActive(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) =>
                moveToEnabledItem(results, index, event.key === "ArrowDown" ? 1 : -1),
              );
            } else if (event.key === "Enter") {
              event.preventDefault();
              select(results[active]);
            }
          }}
        />
      </label>
      {hasResults ? (
        <div
          id={`${optionPrefix}-results`}
          className="ui-command-palette__results"
          role="listbox"
          aria-label={label}
        >
          {results.map((item, index) => (
            <button
              id={`${optionPrefix}-option-${index}`}
              className="ui-command-palette__option"
              key={item.id}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={index === active}
              disabled={item.disabled}
              onPointerMove={() => !item.disabled && setActive(index)}
              onFocus={() => !item.disabled && setActive(index)}
              onClick={() => select(item)}
            >
              {item.icon && (
                <span className="ui-command-palette__option-icon" aria-hidden="true">
                  {item.icon}
                </span>
              )}
              <span className="ui-command-palette__option-copy">
                <strong>{highlightQuery(item.label, query)}</strong>
                {item.detail && (
                  <small className="ui-command-palette__option-detail">
                    {highlightQuery(item.detail, query)}
                  </small>
                )}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="ui-command-palette__empty" role="status">
          {emptyLabel}
        </p>
      )}
    </Dialog>
  );
}

function highlightQuery(value: string, query: string) {
  const needle = query.trim();
  if (!needle) return value;
  const expression = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(expression)) {
    const start = match.index;
    if (start > cursor) parts.push(value.slice(cursor, start));
    parts.push(
      <mark className="ui-command-palette__highlight" key={`${start}-${match[0]}`}>
        {match[0]}
      </mark>,
    );
    cursor = start + match[0].length;
  }
  if (cursor < value.length) parts.push(value.slice(cursor));
  return parts;
}
