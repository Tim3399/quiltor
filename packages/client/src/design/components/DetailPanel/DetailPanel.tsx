import { Trash2, X } from "lucide-react";
import {
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useId,
} from "react";
import { Button } from "../../primitives/Button";
import { IconButton } from "../../primitives/IconButton";
import { Tab, TabList, Tabs } from "../Tabs";
import { useMediaMatch } from "../WorkspaceToolbar";
import "./DetailPanel.css";

function classes(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(" ");
}

/**
 * Up to this width the detail panel is a drawer over the work area instead of a docked column.
 * One width for every world area (figures, places, moments), T-258.
 */
export const DETAIL_COMPACT_QUERY = "(max-width: 820px)";

/** Whether the detail panel is shown as a drawer. */
export function useDetailCompact() {
  return useMediaMatch(DETAIL_COMPACT_QUERY);
}

export interface DetailPanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** Name of the complementary landmark, e.g. "Figuren-Inspector". */
  label: string;
  /** Whether an element is shown. The host owns this: it need not follow the selection. */
  open: boolean;
  /** The element's own name. */
  title?: ReactNode;
  /** The kind above the name, e.g. "Figur". */
  eyebrow?: ReactNode;
  closeLabel: string;
  onClose: () => void;
  /** Header controls before the close button, e.g. previous/next or a "…" menu. */
  headerActions?: ReactNode;
  /** Shown in the docked column while nothing is open. A drawer shows nothing instead. */
  empty?: ReactNode;
  /** Overrides the width query, for hosts that already know their layout. */
  compact?: boolean;
  /** Receives focus after the panel was closed from inside, so keyboard work continues there. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * The one detail surface of the world areas: header (kind, name, close), optional tabs, a
 * scrolling body and a footer that holds the element's delete button.
 *
 * Docked on the right on wide layouts; up to 820px a drawer over the work area (bottom up to
 * 640px). It is complementary at every width and never modal (styleguide 7.2): no backdrop, no
 * focus trap, the board behind it stays usable. Escape inside the panel closes it.
 */
export function DetailPanel({
  label,
  open,
  title,
  eyebrow,
  closeLabel,
  onClose,
  headerActions,
  empty,
  compact: compactOverride,
  returnFocusRef,
  className,
  children,
  onKeyDown,
  ...props
}: DetailPanelProps) {
  const compactQuery = useDetailCompact();
  const compact = compactOverride ?? compactQuery;
  const titleId = useId();
  if (!open && (compact || empty === undefined)) return null;

  const close = () => {
    onClose();
    returnFocusRef?.current?.focus();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.key !== "Escape" || !open) return;
    event.preventDefault();
    close();
  };

  return (
    <aside
      {...props}
      className={classes("detail-panel", className)}
      aria-label={label}
      data-presentation={compact ? "drawer" : "docked"}
      data-state={open ? "open" : "empty"}
      onKeyDown={handleKeyDown}
    >
      {open ? (
        <>
          <header className="detail-panel__header">
            <div className="detail-panel__heading">
              {eyebrow && <span className="detail-panel__eyebrow">{eyebrow}</span>}
              <h2 id={titleId} className="detail-panel__title">
                {title}
              </h2>
            </div>
            <div className="detail-panel__header-actions">
              {headerActions}
              <IconButton label={closeLabel} icon={<X />} size="touch" onClick={close} />
            </div>
          </header>
          {children}
        </>
      ) : (
        empty
      )}
    </aside>
  );
}

export function DetailPanelBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={classes("detail-panel__body", className)} />;
}

export interface DetailPanelTab {
  value: string;
  label: string;
}

export interface DetailPanelTabsProps {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  tabs: readonly DetailPanelTab[];
  /** The TabPanels, normally inside a DetailPanelBody. */
  children: ReactNode;
}

/**
 * Tabs for a panel with two or more content groups. The first tab holds the element's own data.
 * The footer stays outside, so delete is in the same place on every tab.
 */
export function DetailPanelTabs({
  label,
  value,
  onValueChange,
  tabs,
  children,
}: DetailPanelTabsProps) {
  return (
    <Tabs className="detail-panel__tabs" value={value} onValueChange={onValueChange}>
      <TabList label={label} className="detail-panel__tablist">
        {tabs.map((tab) => (
          <Tab key={tab.value} value={tab.value}>
            {tab.label}
          </Tab>
        ))}
      </TabList>
      {children}
    </Tabs>
  );
}

export function DetailPanelFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={classes("detail-panel__footer", className)} />;
}

export interface DetailPanelDeleteButtonProps {
  /** The full action, e.g. "Figur löschen". The product owns the wording. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Why deleting is not possible right now. Shown under the button while it is disabled. */
  disabledReason?: ReactNode;
}

/**
 * The only place an element of a world area is deleted (styleguide 7.4). It opens the host's
 * confirmation; data-delete-scope marks it as the one allowed delete of the whole element.
 */
export function DetailPanelDeleteButton({
  label,
  onClick,
  disabled = false,
  disabledReason,
}: DetailPanelDeleteButtonProps) {
  const reasonId = useId();
  const showReason = disabled && Boolean(disabledReason);
  return (
    <>
      <Button
        className="detail-panel__delete"
        tone="danger"
        icon={<Trash2 />}
        disabled={disabled}
        aria-describedby={showReason ? reasonId : undefined}
        data-delete-scope="element"
        onClick={onClick}
      >
        {label}
      </Button>
      {showReason && (
        <p id={reasonId} className="detail-panel__delete-reason">
          {disabledReason}
        </p>
      )}
    </>
  );
}
