import { forwardRef, type ReactNode, type SelectHTMLAttributes } from "react";
import { Field, type FieldMessageProps } from "../Field";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement>, FieldMessageProps {
  label: ReactNode;
  fieldId?: string;
  fieldClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    fieldId,
    fieldClassName,
    description,
    descriptionId,
    hint,
    hintId,
    error,
    errorId,
    children,
    ...props
  },
  ref,
) {
  return (
    <Field
      id={fieldId}
      className={fieldClassName}
      label={label}
      description={description}
      descriptionId={descriptionId}
      hint={hint}
      hintId={hintId}
      error={error}
      errorId={errorId}
    >
      <select {...props} ref={ref}>
        {children}
      </select>
    </Field>
  );
});
