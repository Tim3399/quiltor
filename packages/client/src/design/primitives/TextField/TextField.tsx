import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { Field, type FieldMessageProps } from "../Field";
import "./TextField.css";

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "children">,
    FieldMessageProps {
  label: ReactNode;
  labelHidden?: boolean;
  fieldId?: string;
  fieldClassName?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
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
      <input {...props} ref={ref} className={`ui-text-field ${className ?? ""}`.trim()} />
    </Field>
  );
});
