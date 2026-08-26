import {
  type AriaAttributes,
  Children,
  cloneElement,
  forwardRef,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  useId,
} from "react";
import "./Field.css";

export interface FieldMessageProps {
  description?: ReactNode;
  descriptionId?: string;
  hint?: ReactNode;
  hintId?: string;
  error?: ReactNode;
  errorId?: string;
}

export interface FieldControlProps {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: AriaAttributes["aria-invalid"];
}

export interface FieldProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children">,
    FieldMessageProps {
  label: ReactNode;
  actions?: ReactNode;
  /** Keeps the accessible label while removing it from visual layout. */
  labelHidden?: boolean;
  controlId?: string;
  children: ReactElement<FieldControlProps>;
}

function hasContent(value: ReactNode): boolean {
  return value !== undefined && value !== null && value !== false && value !== "";
}

function mergeIds(...values: Array<string | undefined>): string | undefined {
  const ids = values.flatMap((value) => value?.split(/\s+/).filter(Boolean) ?? []);
  const uniqueIds = [...new Set(ids)];
  return uniqueIds.length ? uniqueIds.join(" ") : undefined;
}

function isInvalid(value: AriaAttributes["aria-invalid"]): boolean {
  return value === true || value === "true" || value === "grammar" || value === "spelling";
}

export const Field = forwardRef<HTMLDivElement, FieldProps>(function Field(
  {
    label,
    actions,
    labelHidden = false,
    controlId,
    description,
    descriptionId,
    hint,
    hintId,
    error,
    errorId,
    children,
    className,
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const control = Children.only(children) as ReactElement<FieldControlProps>;
  const resolvedControlId = controlId ?? control.props.id ?? generatedId;
  const showsDescription = hasContent(description);
  const showsHint = hasContent(hint);
  const showsError = hasContent(error);
  const resolvedDescriptionId = descriptionId ?? `${resolvedControlId}-description`;
  const resolvedHintId = hintId ?? `${resolvedControlId}-hint`;
  const resolvedErrorId = errorId ?? `${resolvedControlId}-error`;
  const describedBy = mergeIds(
    control.props["aria-describedby"],
    showsDescription ? resolvedDescriptionId : undefined,
    showsHint ? resolvedHintId : undefined,
    showsError ? resolvedErrorId : undefined,
  );
  const invalid = showsError ? true : control.props["aria-invalid"];
  const fieldLabel = (
    <label
      className={`ui-field__label ${labelHidden ? "sr-only" : ""}`.trim()}
      htmlFor={resolvedControlId}
    >
      {label}
    </label>
  );

  return (
    <div
      {...props}
      ref={ref}
      className={`ui-field ${className ?? ""}`.trim()}
      data-invalid={isInvalid(invalid) ? "true" : undefined}
    >
      {actions ? (
        <div className="ui-field__header">
          {fieldLabel}
          <div className="ui-field__actions">{actions}</div>
        </div>
      ) : (
        fieldLabel
      )}
      {showsDescription && (
        <p className="ui-field__description" id={resolvedDescriptionId}>
          {description}
        </p>
      )}
      {cloneElement(control, {
        id: resolvedControlId,
        "aria-describedby": describedBy,
        "aria-invalid": invalid,
      })}
      {showsHint && (
        <p className="ui-field__hint" id={resolvedHintId}>
          {hint}
        </p>
      )}
      {showsError && (
        <p className="ui-field__error" id={resolvedErrorId}>
          {error}
        </p>
      )}
    </div>
  );
});
