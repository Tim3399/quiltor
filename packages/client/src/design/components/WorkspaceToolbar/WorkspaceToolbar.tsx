import { Plus } from "lucide-react";
import {
  type FieldsetHTMLAttributes,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { ScrollArea } from "../ScrollArea";
import { ToolbarButton, type ToolbarButtonProps } from "../ToolbarButton";
import "./WorkspaceToolbar.css";

function classes(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(" ");
}

export interface WorkspaceToolbarProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
}

export function WorkspaceToolbar({ label, className, children, ...props }: WorkspaceToolbarProps) {
  return (
    <div
      {...props}
      className={classes("workspace-toolbar", className)}
      role="toolbar"
      aria-label={label}
    >
      {children}
    </div>
  );
}

export function WorkspaceToolbarTitle({
  title,
  detail,
  className,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  title: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div {...props} className={classes("workspace-toolbar__title", className)}>
      <strong>{title}</strong>
      {detail && <span>{detail}</span>}
    </div>
  );
}

export interface WorkspaceToolbarActionsProps extends HTMLAttributes<HTMLDivElement> {
  layout?: "scroll" | "wrap";
}

export function WorkspaceToolbarActions({
  className,
  layout = "scroll",
  ...props
}: WorkspaceToolbarActionsProps) {
  const actionsClassName = classes("workspace-toolbar__actions", className);

  if (layout === "wrap") {
    return <div {...props} className={actionsClassName} data-layout="wrap" />;
  }

  return (
    <ScrollArea
      {...props}
      axis="x"
      gutter="auto"
      surface="panel"
      className={actionsClassName}
      data-layout="scroll"
    />
  );
}

export function WorkspaceToolbarGroup({
  label,
  className,
  children,
  ...props
}: FieldsetHTMLAttributes<HTMLFieldSetElement> & { label?: string }) {
  return (
    <fieldset {...props} className={classes("workspace-toolbar__group", className)}>
      {label && <legend>{label}</legend>}
      {children}
    </fieldset>
  );
}

export type WorkspaceToolbarCreateButtonProps = Omit<
  ToolbarButtonProps,
  "appearance" | "collapseAt" | "icon" | "labelMode" | "size" | "tone"
> & {
  icon?: ReactNode;
};

/**
 * The single create-action contract for workspace toolbars.
 *
 * Product workspaces provide the label, behavior and optionally a more specific icon;
 * emphasis, sizing and responsive collapse stay identical across every workspace.
 */
export const WorkspaceToolbarCreateButton = forwardRef<
  HTMLButtonElement,
  WorkspaceToolbarCreateButtonProps
>(function WorkspaceToolbarCreateButton({ className, icon = <Plus />, ...props }, ref) {
  return (
    <ToolbarButton
      {...props}
      ref={ref}
      icon={icon}
      appearance="primary"
      size="regular"
      labelMode="responsive"
      collapseAt="compact"
      className={classes("workspace-toolbar__create-button", className)}
      data-workspace-action="create"
    />
  );
});
