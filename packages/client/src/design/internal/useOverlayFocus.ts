import { type RefObject, useEffect, useRef } from "react";

const overlayStack: symbol[] = [];
const focusableSelector =
  'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';

/** Shared focus, Escape and restoration behavior for modal design-system overlays. */
export function useOverlayFocus(
  container: RefObject<HTMLElement | null>,
  active: boolean,
  onClose: () => void,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const id = Symbol("overlay");
    const previous = document.activeElement as HTMLElement | null;
    overlayStack.push(id);
    const frame = requestAnimationFrame(() => {
      const autofocus = container.current?.querySelector<HTMLElement>(
        "[data-autofocus],[autofocus]",
      );
      (autofocus ?? container.current)?.focus();
    });
    const key = (event: KeyboardEvent) => {
      const visibleModals = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')];
      if (
        visibleModals.length
          ? visibleModals.at(-1) !== container.current
          : overlayStack.at(-1) !== id
      ) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !container.current) return;
      const items = [...container.current.querySelectorAll<HTMLElement>(focusableSelector)];
      if (!items.length) {
        event.preventDefault();
        container.current.focus();
        return;
      }
      const first = items[0];
      const last = items.at(-1);
      if (!last) return;
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === container.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", key);
      const index = overlayStack.lastIndexOf(id);
      if (index >= 0) overlayStack.splice(index, 1);
      if (previous?.isConnected) previous.focus();
    };
  }, [active, container]);
}
