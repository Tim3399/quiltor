import { Plus, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button, IconButton, TextField, type TextFieldProps } from "../../../design";

export interface CalendarDefinitionColumn<Item> {
  heading: ReactNode;
  field: (item: Item, index: number) => TextFieldProps;
}

export interface CalendarDefinitionListProps<Item> {
  legend: ReactNode;
  items: readonly Item[];
  columns: readonly CalendarDefinitionColumn<Item>[];
  itemKey: (item: Item, index: number) => string;
  count: number;
  countLabel: string;
  addLabel: string;
  removeLabel: (item: Item, index: number) => string;
  canRemove?: (item: Item, index: number) => boolean;
  onCountChange: (count: number) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}

/** Reusable editor for ordered custom-calendar definitions such as weekdays and months. */
export function CalendarDefinitionList<Item>({
  legend,
  items,
  columns,
  itemKey,
  count,
  countLabel,
  addLabel,
  removeLabel,
  canRemove = () => true,
  onCountChange,
  onAdd,
  onRemove,
}: CalendarDefinitionListProps<Item>) {
  return (
    <fieldset>
      <legend>{legend}</legend>
      {!!items.length && (
        <div className="timeline-calendar-item-head" aria-hidden="true">
          {columns.map((column, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Columns are static presentation slots.
            <span key={index}>{column.heading}</span>
          ))}
          <span />
        </div>
      )}
      {items.map((item, index) => (
        <div className="timeline-calendar-item" key={itemKey(item, index)}>
          {columns.map((column, columnIndex) => {
            const field = column.field(item, index);
            return (
              <TextField
                // biome-ignore lint/suspicious/noArrayIndexKey: Columns are static presentation slots.
                key={columnIndex}
                {...field}
                fieldClassName={`calendar-definition-field ${field.fieldClassName ?? ""}`.trim()}
              />
            );
          })}
          <IconButton
            className="calendar-definition-remove"
            label={removeLabel(item, index)}
            icon={<X />}
            size="regular"
            tone="danger"
            disabled={!canRemove(item, index)}
            onClick={() => onRemove(index)}
          />
        </div>
      ))}
      <div className="timeline-calendar-add-row">
        <TextField
          label={countLabel}
          labelHidden
          fieldClassName="calendar-definition-count-field"
          type="number"
          min="1"
          max="100"
          value={count}
          onChange={(event) => onCountChange(Number(event.target.value))}
        />
        <Button className="calendar-definition-add" size="regular" icon={<Plus />} onClick={onAdd}>
          {addLabel}
        </Button>
      </div>
    </fieldset>
  );
}
