import {
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import "./Tabs.css";

type TabsContextValue = {
  value: string;
  onValueChange: (value: string) => void;
  orientation: "horizontal" | "vertical";
  activationMode: "automatic" | "manual";
  id: string;
  focusedValue: string;
  setFocusedValue: (value: string) => void;
};

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs() {
  const context = useContext(TabsContext);
  if (!context) throw new Error("Tabs parts must be rendered inside Tabs");
  return context;
}

function valueId(value: string) {
  return encodeURIComponent(value).replaceAll("%", "-");
}

export interface TabsProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  value: string;
  onValueChange: (value: string) => void;
  orientation?: "horizontal" | "vertical";
  activationMode?: "automatic" | "manual";
}

export function Tabs({
  value,
  onValueChange,
  orientation = "horizontal",
  activationMode = "automatic",
  className = "",
  children,
  ...props
}: TabsProps) {
  const id = useId();
  const [focusedValue, setFocusedValue] = useState(value);

  useEffect(() => setFocusedValue(value), [value]);

  return (
    <TabsContext.Provider
      value={{
        value,
        onValueChange,
        orientation,
        activationMode,
        id,
        focusedValue,
        setFocusedValue,
      }}
    >
      <div
        {...props}
        className={`design-tabs design-tabs--${orientation} ${className}`.trim()}
        data-orientation={orientation}
      >
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export function TabList({
  label,
  className = "",
  children,
  onKeyDown,
  ...props
}: HTMLAttributes<HTMLDivElement> & { label: string }) {
  const context = useTabs();
  return (
    <div
      {...props}
      className={`design-tabs__list ${className}`.trim()}
      role="tablist"
      aria-label={label}
      aria-orientation={context.orientation}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        const tabs = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'),
        ];
        if (!tabs.length) return;
        const current = Math.max(0, tabs.indexOf(document.activeElement as HTMLButtonElement));
        const previousKey = context.orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
        const nextKey = context.orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
        let next = current;
        if (event.key === previousKey) next = (current - 1 + tabs.length) % tabs.length;
        else if (event.key === nextKey) next = (current + 1) % tabs.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = tabs.length - 1;
        else return;
        event.preventDefault();
        tabs[next].focus();
        if (context.activationMode === "automatic") tabs[next].click();
      }}
    >
      {children}
    </div>
  );
}

export interface TabProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "value"> {
  value: string;
  children: ReactNode;
}

export function Tab({
  value,
  className = "",
  children,
  onClick,
  onFocus,
  disabled = false,
  type = "button",
  ...props
}: TabProps) {
  const context = useTabs();
  const selected = context.value === value;
  const token = valueId(value);
  return (
    <button
      {...props}
      type={type}
      id={`${context.id}-tab-${token}`}
      className={`design-tabs__tab ${className}`.trim()}
      role="tab"
      aria-selected={selected}
      aria-controls={`${context.id}-panel-${token}`}
      tabIndex={!disabled && context.focusedValue === value ? 0 : -1}
      disabled={disabled}
      onFocus={(event) => {
        onFocus?.(event);
        context.setFocusedValue(value);
      }}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          context.setFocusedValue(value);
          context.onValueChange(value);
        }
      }}
    >
      {children}
    </button>
  );
}

export function TabPanel({
  value,
  className = "",
  children,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, "value"> & { value: string }) {
  const context = useTabs();
  const token = valueId(value);
  const selected = context.value === value;
  return (
    <div
      {...props}
      id={`${context.id}-panel-${token}`}
      className={`design-tabs__panel ${className}`.trim()}
      role="tabpanel"
      aria-labelledby={`${context.id}-tab-${token}`}
      hidden={!selected}
    >
      {children}
    </div>
  );
}
