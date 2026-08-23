import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { Field, type FieldMessageProps } from "../Field";

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "children">,
    FieldMessageProps {
  label: ReactNode;
  fieldId?: string;
  fieldClassName?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
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
      <input {...props} ref={ref} />
    </Field>
  );
});
