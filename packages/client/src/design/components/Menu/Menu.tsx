import { ChevronRight } from "lucide-react";
import {
  createContext,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useCompactLayout } from "../../internal/useCompactLayout";
import { Popover } from "../Popover";
import "./Menu.css";

type MenuContextValue = {
  close: () => void;
  closeAfterSelect: () => void;
};

const MenuContext = createContext<MenuContextValue | null>(null);

export interface MenuProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  label: string;
  children: ReactNode;
  onClose: () => void;
  autoFocus?: boolean;
  initialFocus?: "first" | "last";
  onSelectClose?: () => void;
}

/** A WAI-ARIA action menu with roving keyboard focus. */
export function Menu({
  label,
  children,
  onClose,
  autoFocus = true,
  initialFocus = "first",
  onSelectClose,
  className = "",
  onKeyDown,
  onFocus,
  ...props
}: MenuProps) {
  const root = useRef<HTMLDivElement>(null);
  const focusInitialItem = useCallback(() => {
    const items = [
      ...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []),
    ];
    items[initialFocus === "last" ? items.length - 1 : 0]?.focus();
  }, [initialFocus]);
  useEffect(() => {
    if (autoFocus) focusInitialItem();
  }, [autoFocus, focusInitialItem]);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const items = [
      ...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []),
    ];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && items.length) {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      items[(index + offset + items.length) % items.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items.at(-1)?.focus();
    } else if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const search = event.key.toLocaleLowerCase();
      const start = Math.max(index + 1, 0);
      const ordered = [...items.slice(start), ...items.slice(0, start)];
      ordered
        .find((item) => item.textContent?.trim().toLocaleLowerCase().startsWith(search))
        ?.focus();
    }
  };
  return (
    <MenuContext.Provider value={{ close: onClose, closeAfterSelect: onSelectClose ?? onClose }}>
      <div
        {...props}
        ref={root}
        className={`ui-menu ${className}`.trim()}
        role="menu"
        aria-label={label}
        tabIndex={0}
        data-autofocus={autoFocus || undefined}
        onKeyDown={handleKeyDown}
        onFocus={(event) => {
          onFocus?.(event);
          if (!event.defaultPrevented && event.target === event.currentTarget && autoFocus) {
            focusInitialItem();
          }
        }}
      >
        {children}
      </div>
    </MenuContext.Provider>
  );
}

export interface MenuItemProps {
  children?: ReactNode;
  label?: ReactNode;
  icon?: ReactNode;
  shortcut?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  tone?: "neutral" | "danger";
  selected?: boolean;
  closeOnSelect?: boolean;
}

export function MenuItem({
  children,
  label,
  icon,
  shortcut,
  onSelect,
  disabled = false,
  tone = "neutral",
  selected = false,
  closeOnSelect = true,
}: MenuItemProps) {
  const context = useContext(MenuContext);
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      tabIndex={-1}
      data-tone={tone}
      aria-current={selected || undefined}
      onClick={() => {
        if (disabled) return;
        onSelect();
        if (closeOnSelect) context?.closeAfterSelect();
      }}
    >
      {icon && (
        <span className="ui-menu__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="ui-menu__label">{label !== undefined ? label : children}</span>
      {shortcut && <kbd className="ui-menu__shortcut">{shortcut}</kbd>}
    </button>
  );
}

export interface MenuSubmenuProps {
  label: string;
  children: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

/** A keyboard- and pointer-accessible nested action menu with viewport-aware positioning. */
export function MenuSubmenu({ label, children, icon, disabled = false }: MenuSubmenuProps) {
  const parent = useContext(MenuContext);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  // On compact the parent menu sits in a modal sheet, so the submenu becomes a sheet of its own
  // on top of it. An anchored popover would open below the parent sheet, out of reach.
  const compact = useCompactLayout();
  const [autoFocus, setAutoFocus] = useState(true);
  const [initialFocus, setInitialFocus] = useState<"first" | "last">("first");
  const close = useCallback(() => setOpen(false), []);
  const openMenu = (target: "first" | "last", focus: boolean) => {
    if (disabled) return;
    setInitialFocus(target);
    setAutoFocus(focus);
    setOpen(true);
  };
  const closeAll = () => {
    setOpen(false);
    parent?.closeAfterSelect();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="menuitem"
        disabled={disabled}
        tabIndex={-1}
        data-tone="neutral"
        className="ui-menu__submenu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onPointerEnter={(event) => {
          // Only a mouse hovers. A touch or pen fires pointerenter right before the click of the
          // same tap, which would then toggle the submenu shut again. A modal sheet must not open
          // on hover either, so on compact only a tap or click opens it.
          if (event.pointerType === "mouse" && !compact) openMenu("first", false);
        }}
        onClick={() => (open ? close() : openMenu("first", true))}
        onKeyDown={(event) => {
          if (["ArrowRight", "Enter", " "].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            openMenu("first", true);
          } else if (event.key === "ArrowLeft" && open) {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      >
        {icon && (
          <span className="ui-menu__icon" aria-hidden="true">
            {icon}
          </span>
        )}
        <span className="ui-menu__label">{label}</span>
        <ChevronRight className="ui-menu__submenu-indicator" aria-hidden="true" />
      </button>
      <Popover
        anchorRef={triggerRef}
        open={open}
        onClose={close}
        label={label}
        desktopRole="presentation"
        placement="inline-end"
      >
        <Menu
          id={menuId}
          className="ui-menu__submenu"
          label={label}
          onClose={close}
          onSelectClose={closeAll}
          autoFocus={autoFocus}
          initialFocus={initialFocus}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft") return;
            event.preventDefault();
            event.stopPropagation();
            close();
          }}
        >
          {children}
        </Menu>
      </Popover>
    </>
  );
}

export function MenuSeparator({ className = "", ...props }: HTMLAttributes<HTMLHRElement>) {
  return <hr {...props} className={`ui-menu__separator ${className}`.trim()} />;
}

export function ContextMenu(props: MenuProps) {
  return <Menu {...props} />;
}
