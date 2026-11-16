import {
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import "./Tooltip.css";

/** The first hover waits this long (styleguide §6, "Ergänzender Tooltip"). Focus opens at once. */
export const TOOLTIP_HOVER_DELAY_MS = 300;
/** Leaves time to move the pointer from the trigger onto the tooltip without it closing. */
const CLOSE_GRACE_MS = 120;

export interface TooltipTriggerProps {
  ref: Ref<HTMLElement>;
  "aria-describedby": string;
  onPointerEnter: (event: PointerEvent) => void;
  onPointerLeave: (event: PointerEvent) => void;
  onPointerDown: (event: PointerEvent) => void;
  onFocus: (event: FocusEvent) => void;
  onBlur: (event: FocusEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
}

export interface TooltipProps {
  /** Short supplementary help. Never the only place for required information. */
  content: ReactNode;
  /** The trigger, which spreads the given props onto one focusable element. */
  children: (props: TooltipTriggerProps) => ReactNode;
  /** The tooltip's element id, for callers that let another element refer to it as well. */
  id?: string;
}

/**
 * A short hint on hover, keyboard focus and touch, built on the popover surface.
 * The hint stays in the document while closed, so `aria-describedby` always resolves and screen
 * readers read it without opening it; sighted users see it only on demand.
 */
export function Tooltip({ content, children, id }: TooltipProps) {
  const ownId = useId();
  const tooltipId = id ?? ownId;
  // The trigger is held in state, not a ref: the trigger props are built during render.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  // Each request replaces the one before; a pending delay is dropped with it. The timer lives in
  // an effect so that the trigger props, built during render, never touch a ref.
  const [intent, setIntent] = useState<{ open: boolean; delay: number } | null>(null);
  const schedule = useCallback((next: boolean, delay: number) => {
    if (delay > 0) {
      setIntent({ open: next, delay });
      return;
    }
    setIntent(null);
    setOpen(next);
  }, []);
  useEffect(() => {
    if (!intent) return;
    const timer = setTimeout(() => setOpen(intent.open), intent.delay);
    return () => clearTimeout(timer);
  }, [intent]);

  useLayoutEffect(() => {
    if (!open || !anchor || !panel.current) return;
    const box = anchor.getBoundingClientRect();
    const tip = panel.current.getBoundingClientRect();
    const gap = 6;
    const margin = 12;
    const left = Math.max(margin, Math.min(box.left, innerWidth - tip.width - margin));
    const below = box.bottom + gap;
    const top =
      below + tip.height <= innerHeight - margin
        ? below
        : Math.max(margin, box.top - tip.height - gap);
    setPosition({ left, top });
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: globalThis.PointerEvent) => {
      const target = event.target as Node;
      if (!anchor?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open, anchor]);

  const trigger: TooltipTriggerProps = {
    ref: setAnchor,
    "aria-describedby": tooltipId,
    onPointerEnter: (event) => {
      if (event.pointerType !== "touch") schedule(true, TOOLTIP_HOVER_DELAY_MS);
    },
    onPointerLeave: (event) => {
      if (event.pointerType !== "touch") schedule(false, CLOSE_GRACE_MS);
    },
    // A touch has no hover: a tap toggles the hint instead.
    onPointerDown: (event) => {
      if (event.pointerType === "touch") schedule(!open, 0);
    },
    onFocus: () => schedule(true, 0),
    onBlur: () => schedule(false, 0),
    onKeyDown: (event) => {
      if (event.key === "Escape" && open) {
        event.stopPropagation();
        schedule(false, 0);
      }
    },
  };

  return (
    <>
      {children(trigger)}
      {createPortal(
        <div
          ref={panel}
          id={tooltipId}
          role="tooltip"
          className="ui-tooltip ui-popover material-popover"
          hidden={!open}
          style={position}
          onPointerEnter={() => schedule(true, 0)}
          onPointerLeave={() => schedule(false, CLOSE_GRACE_MS)}
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  );
}
