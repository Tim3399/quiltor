import { forwardRef, type ReactNode } from "react";
import { Button, type ButtonProps } from "../../primitives/Button";
import "./ToolbarButton.css";

export type ToolbarButtonLabelMode = "always" | "responsive" | "hidden";

export interface ToolbarButtonProps extends Omit<ButtonProps, "children" | "icon"> {
  label: string;
  icon: ReactNode;
  labelMode?: ToolbarButtonLabelMode;
}

function classNames(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(" ");
}

export const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  function ToolbarButton(
    {
      label,
      icon,
      labelMode = "responsive",
      appearance = "ghost",
      size = "compact",
      className,
      title,
      "aria-label": ariaLabel,
      ...props
    },
    ref,
  ) {
    return (
      <Button
        {...props}
        ref={ref}
        appearance={appearance}
        size={size}
        icon={icon}
        className={classNames("ui-toolbar-button", className)}
        data-label-mode={labelMode}
        aria-label={ariaLabel ?? label}
        title={title ?? label}
      >
        {label}
      </Button>
    );
  },
);
