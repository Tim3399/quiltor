import { forwardRef, type ReactNode, type SelectHTMLAttributes } from "react";
import { Field, type FieldMessageProps } from "../Field";
import "./Select.css";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement>, FieldMessageProps {
  label: ReactNode;
  labelHidden?: boolean;
  fieldId?: string;
  fieldClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    labelHidden,
    fieldId,
    fieldClassName,
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
  return (
    <Field
      id={fieldId}
      className={fieldClassName}
      label={label}
      labelHidden={labelHidden}
      description={description}
      descriptionId={descriptionId}
      hint={hint}
      hintId={hintId}
      error={error}
      errorId={errorId}
    >
      <select {...props} ref={ref} className={`ui-select ${className ?? ""}`.trim()}>
        {children}
      </select>
    </Field>
  );
});
