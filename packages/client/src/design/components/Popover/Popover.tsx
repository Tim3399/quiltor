import {
  type ReactNode,
  type RefObject,
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
  compactMode?: "sheet" | "popover";
}

/** An anchored desktop popover which can adapt to a modal compact sheet. */
export function Popover({
  anchorRef,
  open,
  onClose,
  children,
  label,
  compactMode = "sheet",
}: PopoverProps) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const compactViewport = useCompactLayout();
  const compact = compactMode === "sheet" && compactViewport;
  const [position, setPosition] = useState({ left: 12, top: 12 });

  useLayoutEffect(() => {
    if (!open || compact || !anchorRef.current || !panel.current) return;
    const anchor = anchorRef.current.getBoundingClientRect();
    const box = panel.current.getBoundingClientRect();
    const gap = 6;
    const margin = 12;
    const left = Math.max(margin, Math.min(anchor.left, innerWidth - box.width - margin));
    const below = anchor.bottom + gap;
    const top =
      below + box.height <= innerHeight ? below : Math.max(margin, anchor.top - box.height - gap);
    setPosition({ left, top });
  }, [open, compact, anchorRef]);

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
    const close = () => closeRef.current();
    document.addEventListener("pointerdown", pointer);
    trigger?.addEventListener("keydown", key);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      trigger?.removeEventListener("keydown", key);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      if (trigger?.isConnected) trigger.focus();
    };
  }, [open, compact, anchorRef]);

  if (!open) return null;
  if (compact) {
    return createPortal(
      <Sheet open label={label} onClose={onClose}>
        <div className="ui-popover-sheet">{children}</div>
      </Sheet>,
      document.body,
    );
  }
  return createPortal(
    <div
      ref={panel}
      className="ui-popover material-popover"
      role="dialog"
      aria-label={label}
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
    document.body,
  );
}
