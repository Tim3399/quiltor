import {
  type KeyboardEventHandler,
  type MouseEventHandler,
  type ReactNode,
  type Ref,
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
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  compactMode?: "sheet" | "popover";
}

/** Owns trigger semantics, open state, close behavior and focus restoration for an action menu. */
export function DropdownMenu({
  label,
  renderTrigger,
  children,
  open,
  defaultOpen = false,
  onOpenChange,
  compactMode = "sheet",
}: DropdownMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const resolvedOpen = open ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange, open],
  );
  const close = useCallback(() => setOpen(false), [setOpen]);

  const triggerProps: DropdownMenuTriggerProps = {
    ref: triggerRef,
    type: "button",
    "aria-haspopup": "menu",
    "aria-expanded": resolvedOpen,
    "aria-controls": resolvedOpen ? menuId : undefined,
    onClick: () => setOpen(!resolvedOpen),
    onKeyDown: (event) => {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        setOpen(true);
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
      >
        <Menu id={menuId} className="ui-dropdown-menu" label={label} onClose={close}>
          {children}
        </Menu>
      </Popover>
    </>
  );
}
