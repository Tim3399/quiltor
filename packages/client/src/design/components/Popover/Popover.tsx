import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Sheet } from "../Sheet";
import "./Popover.css";

const compactQuery = "(max-width: 719px)";

function useCompactLayout() {
  const [compact, setCompact] = useState(
    () => typeof matchMedia === "function" && matchMedia(compactQuery).matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const media = matchMedia(compactQuery);
    const change = () => setCompact(media.matches);
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return compact;
}

export interface PopoverProps {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  label: string;
  className?: string;
  compactMode?: "sheet" | "popover";
  desktopRole?: "dialog" | "presentation";
  placement?: "block" | "inline-end";
  /** Optional semantic owner for overlays opened inside another modal surface. */
  portalContainerRef?: RefObject<HTMLElement | null>;
}

/** An anchored desktop popover which can adapt to a modal compact sheet. */
export function Popover({
  anchorRef,
  open,
  onClose,
  children,
  label,
  className = "",
  compactMode = "sheet",
  desktopRole = "dialog",
  placement = "block",
  portalContainerRef,
}: PopoverProps) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const compactViewport = useCompactLayout();
  const compact = compactMode === "sheet" && compactViewport;
  const [position, setPosition] = useState({ left: 12, top: 12 });

  const updatePosition = useCallback(() => {
    if (!open || compact || !anchorRef.current || !panel.current) return;
    const anchor = anchorRef.current.getBoundingClientRect();
    const box = panel.current.getBoundingClientRect();
    const gap = 6;
    const margin = 12;
    if (placement === "inline-end") {
      const after = anchor.right + gap;
      const left =
        after + box.width <= innerWidth - margin
          ? after
          : Math.max(margin, anchor.left - box.width - gap);
      const top = Math.max(margin, Math.min(anchor.top, innerHeight - box.height - margin));
      setPosition({ left, top });
      return;
    }
    const left = Math.max(margin, Math.min(anchor.left, innerWidth - box.width - margin));
    const below = anchor.bottom + gap;
    const top =
      below + box.height <= innerHeight ? below : Math.max(margin, anchor.top - box.height - gap);
    setPosition({ left, top });
  }, [anchorRef, compact, open, placement]);

  useLayoutEffect(() => {
    updatePosition();
    if (!open || compact || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(updatePosition);
    if (anchorRef.current) observer.observe(anchorRef.current);
    if (panel.current) observer.observe(panel.current);
    return () => observer.disconnect();
  }, [anchorRef, compact, open, updatePosition]);

  useEffect(() => {
    if (!open || compact) return;
    const trigger = anchorRef.current;
    const pointer = (event: PointerEvent) => {
      if (
        !panel.current?.contains(event.target as Node) &&
        !trigger?.contains(event.target as Node)
      ) {
        closeRef.current();
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (event.defaultPrevented) return;
      event.preventDefault();
      closeRef.current();
    };
    const resize = () => closeRef.current();
    const scroll = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      closeRef.current();
    };
    document.addEventListener("pointerdown", pointer);
    trigger?.addEventListener("keydown", key);
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      trigger?.removeEventListener("keydown", key);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", scroll, true);
      if (trigger?.isConnected) trigger.focus();
    };
  }, [open, compact, anchorRef]);

  if (!open) return null;
  const portalContainer = portalContainerRef?.current ?? document.body;
  if (compact) {
    return createPortal(
      <Sheet
        open
        label={label}
        className={`ui-popover-sheet-container ${className}`.trim()}
        onClose={onClose}
        returnFocusRef={anchorRef}
      >
        <div className="ui-popover-sheet">{children}</div>
      </Sheet>,
      portalContainer,
    );
  }
  const desktopAccessibilityProps =
    desktopRole === "dialog"
      ? ({ role: "dialog", "aria-label": label } as const)
      : ({ role: "presentation" } as const);
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: the semantic child owns interaction; this surface only contains Escape before it leaks to an owning modal.
    <div
      {...desktopAccessibilityProps}
      ref={panel}
      className={`ui-popover material-popover ${className}`.trim()}
      style={position}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        if (event.defaultPrevented) return;
        event.preventDefault();
        closeRef.current();
      }}
    >
      {children}
    </div>,
    portalContainer,
  );
}
