import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Dialog } from './Dialog';

export type CommandPaletteItem = {
  id: string;
  label: string;
  detail?: string;
  keywords?: string[];
  icon?: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
};

export function CommandPalette({ open, label, placeholder, emptyLabel, items, onClose }: {
  open: boolean; label: string; placeholder: string; emptyLabel: string; items: CommandPaletteItem[]; onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const optionPrefix = useId();
  useEffect(() => { if (open) { setQuery(''); setActive(0); } }, [open]);
  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return items.filter(item => !needle || [item.label, item.detail, ...(item.keywords || [])].some(value => value?.toLocaleLowerCase().includes(needle)));
  }, [items, query]);
  if (!open) return null;
  const select = (item: CommandPaletteItem | undefined) => { if (item && !item.disabled) { item.onSelect(); onClose(); } };
  return <Dialog title={label} onClose={onClose} wide>
    <label className="ui-command-palette__search"><Search aria-hidden="true" /><span className="sr-only">{label}</span><input autoFocus role="combobox" aria-expanded="true" aria-controls={`${optionPrefix}-results`} aria-activedescendant={results[active] ? `${optionPrefix}-${results[active].id}` : undefined} value={query} placeholder={placeholder} onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(0, Math.min(results.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))); }
      else if (event.key === 'Enter') { event.preventDefault(); select(results[active]); }
    }} /></label>
    <div id={`${optionPrefix}-results`} className="ui-command-palette__results" role="listbox" aria-label={label}>
      {results.map((item, index) => <button id={`${optionPrefix}-${item.id}`} key={item.id} type="button" role="option" aria-selected={index === active} disabled={item.disabled} onPointerMove={() => setActive(index)} onFocus={() => setActive(index)} onClick={() => select(item)}>
        {item.icon}<span><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</span>
      </button>)}
      {!results.length && <p>{emptyLabel}</p>}
    </div>
  </Dialog>;
}
