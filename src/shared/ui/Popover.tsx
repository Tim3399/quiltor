import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Sheet } from "./Sheet";

function useCompactLayout() {
  const query = "(max-width: 719px)";
  const [compact, setCompact] = useState(
    () => typeof matchMedia === "function" && matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const media = matchMedia(query),
      change = () => setCompact(media.matches);
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return compact;
}

export function Popover({
  anchorRef,
  open,
  onClose,
  children,
  label = "",
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  label?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const compact = useCompactLayout();
  const [position, setPosition] = useState({ left: 12, top: 12 });

  useLayoutEffect(() => {
    if (!open || compact || !anchorRef.current || !panel.current) return;
    const anchor = anchorRef.current.getBoundingClientRect(),
      box = panel.current.getBoundingClientRect(),
      gap = 6,
      margin = 12;
    const left = Math.max(margin, Math.min(anchor.left, innerWidth - box.width - margin));
    const below = anchor.bottom + gap;
    const top =
      below + box.height <= innerHeight ? below : Math.max(margin, anchor.top - box.height - gap);
    setPosition({ left, top });
  }, [open, compact, anchorRef, children]);

  useEffect(() => {
    if (!open || compact) return;
    const trigger = anchorRef.current;
    const pointer = (event: PointerEvent) => {
      if (
        !panel.current?.contains(event.target as Node) &&
        !trigger?.contains(event.target as Node)
      )
        closeRef.current();
    };
    const key = (event: KeyboardEvent) => {
      const topModal = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].at(-1);
      if (event.key === "Escape" && (!topModal || topModal.contains(panel.current))) {
        event.preventDefault();
        closeRef.current();
      }
    };
    const close = () => closeRef.current();
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      if (trigger?.isConnected) trigger.focus();
    };
  }, [open, compact, anchorRef]);

  if (!open) return null;
  // Das Panel haengt am document.body statt an seinem Ausloeser. Sonst erbt es dessen
  // Stapelkontext: die Werkzeugleiste traegt `z-index:var(--z-sticky)`, und ein darin
  // geborenes Popover kam nie ueber die Schublade daneben, egal wie hoch --z-popover steht.
  // Ein hoeherer z-index an der Leiste haette denselben Streit nur vertagt.
  // Die Koordinaten bleiben gleich: sie kommen aus getBoundingClientRect() des Ausloesers
  // und werden auf ein `position:fixed` angewandt -- beides bezieht sich auf das Fenster.
  if (compact)
    return createPortal(
      <Sheet open label={label} onClose={onClose}>
        <div className="ui-popover-sheet">{children}</div>
      </Sheet>,
      document.body,
    );
  return createPortal(
    <div
      ref={panel}
      className="ui-popover material-popover"
      role="dialog"
      aria-label={label || undefined}
      style={position}
    >
      {children}
    </div>,
    document.body,
  );
}
