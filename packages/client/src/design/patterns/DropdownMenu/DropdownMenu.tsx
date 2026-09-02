import {
  type KeyboardEventHandler,
  type MouseEventHandler,
  type ReactNode,
  type Ref,
  type RefObject,
  useCallback,
  useId,
  useRef,
  useState,
} from "react";
import { Menu } from "../../components/Menu";
import { Popover } from "../../components/Popover";
import "./DropdownMenu.css";

export interface DropdownMenuTriggerProps {
  ref: Ref<HTMLButtonElement>;
  type: "button";
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "aria-controls": string | undefined;
  onClick: MouseEventHandler<HTMLButtonElement>;
  onKeyDown: KeyboardEventHandler<HTMLButtonElement>;
}

export interface DropdownMenuProps {
  label: string;
  renderTrigger: (props: DropdownMenuTriggerProps) => ReactNode;
  children: ReactNode;
  header?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  compactMode?: "sheet" | "popover";
  /** Semantic owner when the menu opens from inside another modal surface. */
  portalContainerRef?: RefObject<HTMLElement | null>;
}

/** Owns trigger semantics, open state, close behavior and focus restoration for an action menu. */
export function DropdownMenu({
  label,
  renderTrigger,
  children,
  header,
  open,
  defaultOpen = false,
  onOpenChange,
  compactMode = "sheet",
  portalContainerRef,
}: DropdownMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [initialFocus, setInitialFocus] = useState<"first" | "last">("first");
  const resolvedOpen = open ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange, open],
  );
  const close = useCallback(() => setOpen(false), [setOpen]);
  const openWithFocus = (target: "first" | "last") => {
    setInitialFocus(target);
    setOpen(true);
  };

  const triggerProps: DropdownMenuTriggerProps = {
    ref: triggerRef,
    type: "button",
    "aria-haspopup": "menu",
    "aria-expanded": resolvedOpen,
    "aria-controls": resolvedOpen ? menuId : undefined,
    onClick: () => {
      if (resolvedOpen) close();
      else openWithFocus("first");
    },
    onKeyDown: (event) => {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openWithFocus(event.key === "ArrowUp" ? "last" : "first");
      } else if (event.key === "Escape" && resolvedOpen) {
        event.preventDefault();
        close();
      }
    },
  };

  return (
    <>
      {renderTrigger(triggerProps)}
      <Popover
        anchorRef={triggerRef}
        open={resolvedOpen}
        onClose={close}
        label={label}
        compactMode={compactMode}
        desktopRole="presentation"
        portalContainerRef={portalContainerRef}
      >
        <div className="ui-dropdown-menu__surface">
          {header && <div className="ui-dropdown-menu__header">{header}</div>}
          <Menu
            id={menuId}
            className="ui-dropdown-menu"
            label={label}
            onClose={close}
            initialFocus={initialFocus}
          >
            {children}
          </Menu>
        </div>
      </Popover>
    </>
  );
}
