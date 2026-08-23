import {
  type AriaAttributes,
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  useId,
} from "react";
import "./Checkbox.css";

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "children" | "type"> {
  label: ReactNode;
  description?: ReactNode;
  descriptionId?: string;
  hint?: ReactNode;
  hintId?: string;
  error?: ReactNode;
  errorId?: string;
  containerId?: string;
  containerClassName?: string;
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

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  {
    label,
    description,
    descriptionId,
    hint,
    hintId,
    error,
    errorId,
    containerId,
    containerClassName,
    id,
    className,
    disabled = false,
    "aria-describedby": ariaDescribedBy,
    "aria-invalid": ariaInvalid,
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const resolvedId = id ?? generatedId;
  const showsDescription = hasContent(description);
  const showsHint = hasContent(hint);
  const showsError = hasContent(error);
  const resolvedDescriptionId = descriptionId ?? `${resolvedId}-description`;
  const resolvedHintId = hintId ?? `${resolvedId}-hint`;
  const resolvedErrorId = errorId ?? `${resolvedId}-error`;
  const describedBy = mergeIds(
    ariaDescribedBy,
    showsDescription ? resolvedDescriptionId : undefined,
    showsHint ? resolvedHintId : undefined,
    showsError ? resolvedErrorId : undefined,
  );
  const invalid = showsError ? true : ariaInvalid;
  const hasSupportingText = showsDescription || showsHint || showsError;

  return (
    <div
      id={containerId}
      className={`ui-checkbox ${containerClassName ?? ""}`.trim()}
      data-disabled={disabled || undefined}
      data-invalid={isInvalid(invalid) || undefined}
    >
      <label className="ui-checkbox__action" htmlFor={resolvedId}>
        <input
          {...props}
          ref={ref}
          id={resolvedId}
          type="checkbox"
          className={`ui-checkbox__control ${className ?? ""}`.trim()}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={invalid}
        />
        <span className="ui-checkbox__label">{label}</span>
      </label>
      {hasSupportingText && (
        <div className="ui-checkbox__messages">
          {showsDescription && (
            <span className="ui-checkbox__description" id={resolvedDescriptionId}>
              {description}
            </span>
          )}
          {showsHint && (
            <span className="ui-checkbox__hint" id={resolvedHintId}>
              {hint}
            </span>
          )}
          {showsError && (
            <span className="ui-checkbox__error" id={resolvedErrorId}>
              {error}
            </span>
          )}
        </div>
      )}
    </div>
  );
});
