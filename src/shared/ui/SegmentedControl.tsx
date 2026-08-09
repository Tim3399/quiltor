export type Segment<T extends string> = { value: T; label: string; disabled?: boolean };

export function SegmentedControl<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Segment<T>[]; onChange: (value: T) => void }) {
  return <div className="ui-segmented" role="radiogroup" aria-label={label}>{options.map(option => <button key={option.value} type="button" role="radio" aria-checked={value === option.value} disabled={option.disabled} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>;
}
