import {
  createContext,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
} from "react";
import "./Menu.css";

type MenuContextValue = {
  close: () => void;
  autoFocus: boolean;
};

const MenuContext = createContext<MenuContextValue | null>(null);

export interface MenuProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  label: string;
  children: ReactNode;
  onClose: () => void;
  autoFocus?: boolean;
}

/** A WAI-ARIA action menu with roving keyboard focus. */
export function Menu({
  label,
  children,
  onClose,
  autoFocus = true,
  className = "",
  onKeyDown,
  ...props
}: MenuProps) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoFocus) {
      root.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    }
  }, [autoFocus]);
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
    <MenuContext.Provider value={{ close: onClose, autoFocus }}>
      <div
        {...props}
        ref={root}
        className={`ui-menu ${className}`.trim()}
        role="menu"
        aria-label={label}
        onKeyDown={handleKeyDown}
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
      data-autofocus={(context?.autoFocus && !disabled) || undefined}
      data-tone={tone}
      aria-current={selected || undefined}
      onClick={() => {
        if (disabled) return;
        onSelect();
        if (closeOnSelect) context?.close();
      }}
    >
      {icon && (
        <span className="ui-menu__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {label !== undefined ? <span className="ui-menu__label">{label}</span> : children}
      {shortcut && <kbd className="ui-menu__shortcut">{shortcut}</kbd>}
    </button>
  );
}

export function MenuSeparator({ className = "", ...props }: HTMLAttributes<HTMLHRElement>) {
  return <hr {...props} className={`ui-menu__separator ${className}`.trim()} />;
}

export function ContextMenu(props: MenuProps) {
  return <Menu {...props} />;
}
