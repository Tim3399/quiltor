import { Plus } from "lucide-react";
import {
  type FieldsetHTMLAttributes,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { ScrollArea } from "../ScrollArea";
import { ToolbarButton, type ToolbarButtonProps } from "../ToolbarButton";
import "./WorkspaceToolbar.css";

/**
 * Whether a media query matches, kept current. A toolbar uses it to move undo and redo into its
 * overflow menu on widths where they no longer fit as icons: hiding them with CSS would leave a
 * phone without undo, since there is no keyboard shortcut there (T-104, F-104-1).
 */
export function useMediaMatch(query: string) {
  const [matches, setMatches] = useState(
    () => typeof matchMedia === "function" && matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const media = matchMedia(query);
    const change = () => setMatches(media.matches);
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, [query]);
  return matches;
}

/**
 * The width below which a toolbar row is compact: every button is an icon at touch size
 * (ToolbarButton.css), and a row holds at most six of them (styleguide 7.4, T-258). Width only,
 * on purpose: a tablet with a coarse pointer has room for a full row of touch buttons.
 */
export const COMPACT_TOOLBAR_QUERY = "(max-width: 719px)";

/** Whether the toolbar row is compact, so its lowest-priority toggles belong in "…". */
export function useCompactToolbar() {
  return useMediaMatch(COMPACT_TOOLBAR_QUERY);
}

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
  /** Creating something new. At most one action in here carries primary emphasis. */
  create?: ReactNode;
  /** What the workspace shows: panel toggles, view menus and modes. */
  view?: ReactNode;
  /** The workspace's own history: undo, redo and stored versions. */
  history?: ReactNode;
  /** Acting on what already exists: export, manage, delete. */
  actions?: ReactNode;
  /**
   * The secondary actions that do not earn a place in the row: a `DropdownMenu` whose
   * trigger is an icon-only `ToolbarButton`. It always sits last, after `actions`.
   */
  overflow?: ReactNode;
}

/**
 * The action strip renders its five slots in one fixed order for every workspace:
 * create, view, history, actions, overflow.
 *
 * A workspace decides what goes into a slot, never where the slot sits. That is the
 * whole point of the strip taking slots instead of children: the manuscript, the world,
 * the timeline, the places and the storyboard cannot each invent their own order, so
 * the same kind of action stays in the same place across the application.
 *
 * The strip is exactly one row on every layout. It never wraps; what does not fit goes
 * into the overflow menu, chosen by how often and how urgently an author needs it.
 */
export function WorkspaceToolbarActions({
  className,
  create,
  view,
  history,
  actions,
  overflow,
  ...props
}: WorkspaceToolbarActionsProps) {
  const actionsClassName = classes("workspace-toolbar__actions", className);
  const slots = (
    <>
      {create}
      {view}
      {history}
      {actions}
      {overflow && <div className="workspace-toolbar__overflow">{overflow}</div>}
    </>
  );

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
