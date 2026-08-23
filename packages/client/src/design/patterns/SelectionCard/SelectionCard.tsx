import {
  forwardRef,
  type ButtonHTMLAttributes,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import "./SelectionCard.css";

type SelectionCardActionSlotProps =
  | { actions?: undefined; actionsLabel?: never }
  | { actions: ReactNode; actionsLabel: string };

export type SelectionCardProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "children" | "className" | "onClick" | "title"
> & {
  /** Accessible name of the card's primary action. */
  label: string;
  title: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  indicator?: ReactNode;
  selected?: boolean;
  className?: string;
  onSelect: MouseEventHandler<HTMLButtonElement>;
} & SelectionCardActionSlotProps;

function classNames(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(" ");
}

/**
 * A spacious, single-purpose selection action with optional independent trailing actions.
 *
 * The trailing action slot deliberately lives outside the primary button so consumers never
 * create nested interactive controls. Product code owns the text and event handlers; this pattern
 * owns hierarchy, touch targets, focus and responsive layout.
 */
export const SelectionCard = forwardRef<HTMLButtonElement, SelectionCardProps>(
  function SelectionCard(
    {
      label,
      title,
      description,
      leading,
      indicator,
      actions,
      actionsLabel,
      selected = false,
      className,
      onSelect,
      disabled = false,
      type = "button",
      ...props
    },
    ref,
  ) {
    return (
      <div
        className={classNames("selection-card", selected && "selection-card--selected", className)}
        data-disabled={disabled || undefined}
        data-selected={selected || undefined}
      >
        <button
          {...props}
          ref={ref}
          type={type}
          className="selection-card__action"
          aria-label={label}
          aria-current={selected ? "true" : undefined}
          disabled={disabled}
          onClick={onSelect}
        >
          {leading && (
            <span className="selection-card__leading" aria-hidden="true">
              {leading}
            </span>
          )}
          <span className="selection-card__copy">
            <span className="selection-card__title">{title}</span>
            {description && <span className="selection-card__description">{description}</span>}
          </span>
          {indicator && (
            <span className="selection-card__indicator" aria-hidden="true">
              {indicator}
            </span>
          )}
        </button>
        {actions && (
          <fieldset className="selection-card__actions" aria-label={actionsLabel}>
            {actions}
          </fieldset>
        )}
      </div>
    );
  },
);
