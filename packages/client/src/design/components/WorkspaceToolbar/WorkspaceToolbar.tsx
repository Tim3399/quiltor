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

export interface WorkspaceToolbarActionsProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  layout?: "scroll" | "wrap";
  /** Creating something new. At most one action in here carries primary emphasis. */
  create?: ReactNode;
  /** What the workspace shows: panel toggles, view menus and modes. */
  view?: ReactNode;
  /** The workspace's own history: undo, redo and stored versions. */
  history?: ReactNode;
  /** Acting on what already exists: export, manage, delete. */
  actions?: ReactNode;
}

/**
 * The action strip renders its four slots in one fixed order for every workspace:
 * create, view, history, actions.
 *
 * A workspace decides what goes into a slot, never where the slot sits. That is the
 * whole point of the strip taking slots instead of children: the manuscript, the world,
 * the timeline, the places and the storyboard cannot each invent their own order, so
 * the same kind of action stays in the same place across the application.
 */
export function WorkspaceToolbarActions({
  className,
  layout = "scroll",
  create,
  view,
  history,
  actions,
  ...props
}: WorkspaceToolbarActionsProps) {
  const actionsClassName = classes("workspace-toolbar__actions", className);
  const slots = (
    <>
      {create}
      {view}
      {history}
      {actions}
    </>
  );

  if (layout === "wrap") {
    return (
      <div {...props} className={actionsClassName} data-layout="wrap">
        {slots}
      </div>
    );
  }

  return (
    <ScrollArea
      {...props}
      axis="x"
      gutter="auto"
      surface="panel"
      className={actionsClassName}
      data-layout="scroll"
    >
      {slots}
    </ScrollArea>
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
