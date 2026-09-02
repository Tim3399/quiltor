import { type RefObject, useEffect, useRef } from "react";

const overlayStack: symbol[] = [];
const focusableSelector =
  'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';

/** Shared focus, Escape and restoration behavior for modal design-system overlays. */
export function useOverlayFocus(
  container: RefObject<HTMLElement | null>,
  active: boolean,
  onClose: () => void,
  returnFocusRef?: RefObject<HTMLElement | null>,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const id = Symbol("overlay");
    const previous = document.activeElement as HTMLElement | null;
    const returnFocus = returnFocusRef?.current ?? previous;
    overlayStack.push(id);
    const modal = container.current;
    const renderedModals = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')];
    const modalIndex = modal ? renderedModals.indexOf(modal) : -1;
    const obscuredModals = (modalIndex >= 0 ? renderedModals.slice(0, modalIndex) : []).map(
      (element) => ({
        element,
        ariaHidden: element.getAttribute("aria-hidden"),
        inert: element.hasAttribute("inert"),
      }),
    );
    for (const { element } of obscuredModals) {
      element.setAttribute("aria-hidden", "true");
      element.setAttribute("inert", "");
    }
    // Straight away, in the same task as the event that opened the overlay.
    // A frame's delay is a window in which typing still lands wherever focus
    // was -- and an overlay opened by a keyboard shortcut is opened by someone
    // whose hands are already moving. A search field that swallowed its own
    // first letters into the manuscript behind it is what that looked like.
    const claimFocus = () => {
      const target =
        container.current?.querySelector<HTMLElement>("[data-autofocus],[autofocus]") ??
        container.current;
      target?.focus();
    };
    claimFocus();
    // Once more next frame, but only if it did not land: some overlays fill
    // themselves in a beat later, and their autofocus target does not exist yet
    // above. Re-focusing unconditionally would undo a deliberate move inside.
    const frame = requestAnimationFrame(() => {
      if (container.current?.contains(document.activeElement)) return;
      claimFocus();
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
      for (const { element, ariaHidden, inert } of obscuredModals) {
        if (!element.isConnected) continue;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
        if (!inert) element.removeAttribute("inert");
      }
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [active, container, returnFocusRef]);
}
