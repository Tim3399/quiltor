import { type RefObject, useLayoutEffect, useRef } from "react";
import { useLatest } from "../../../shared/hooks/useLatest";

/**
 * Keeps the graph still while the docked timeline strip above it changes height.
 *
 * The strip sits in its own grid row, so every pixel it grows moves the canvas's top edge --
 * and React Flow's origin with it -- down by one pixel. Choosing a moment adds the detail
 * row (80px at desk width, 136px at hand width), and showing or hiding the strip adds or
 * removes all of it. The measured difference is handed to `shift` from a layout effect and
 * from the ResizeObserver, both of which run before the browser paints, so the jump is never
 * drawn. Bound to the measured height rather than to the toggle, because the toggle is only
 * one of many causes (moment choice, playback start, a blocked-delete hint, wrapping).
 */
export function useDockedStripOffset(
  stripRef: RefObject<HTMLElement | null>,
  open: boolean,
  shift: (dy: number) => void,
) {
  const height = useRef(0);
  const shiftRef = useLatest(shift);

  useLayoutEffect(() => {
    const element = stripRef.current;
    const apply = (next: number) => {
      const delta = next - height.current;
      height.current = next;
      if (delta) shiftRef.current(delta);
    };
    if (!open || !element) {
      apply(0);
      return;
    }
    apply(element.offsetHeight);
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => apply(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [open, shiftRef, stripRef]);
}
