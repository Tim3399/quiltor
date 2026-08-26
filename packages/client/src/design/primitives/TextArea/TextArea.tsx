import { forwardRef, type ReactNode, type TextareaHTMLAttributes } from "react";
import { Field, type FieldMessageProps } from "../Field";
import "./TextArea.css";

export interface TextAreaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "children">,
    FieldMessageProps {
  label: ReactNode;
  actions?: ReactNode;
  labelHidden?: boolean;
  fieldId?: string;
  fieldClassName?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  {
    label,
    actions,
    labelHidden,
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
      actions={actions}
      labelHidden={labelHidden}
      description={description}
      descriptionId={descriptionId}
      hint={hint}
      hintId={hintId}
      error={error}
      errorId={errorId}
    >
      <textarea {...props} ref={ref} />
    </Field>
  );
});
