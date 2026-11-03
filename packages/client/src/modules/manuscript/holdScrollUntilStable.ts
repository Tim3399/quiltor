/**
 * Writes a restored scroll position and keeps it there until a measure cycle passes
 * without moving it.
 *
 * One write after the first measure is not enough: CodeMirror can correct line heights
 * in a later measure and anchor the scroll, which on macOS moved a restored position by
 * one line (17 px, ci.md F7). Each round waits for the next measure, checks whether the
 * position still holds and writes it again if not. `maxRounds` bounds a layout that never
 * settles.
 */
export function holdScrollUntilStable({
  scroller,
  top,
  afterMeasure,
  onSettled,
  maxRounds = 8,
}: {
  scroller: { scrollTop: number };
  top: number;
  afterMeasure: (callback: (hasFocus: boolean) => void) => () => void;
  onSettled: (hasFocus: boolean) => void;
  maxRounds?: number;
}): () => void {
  let cancel: () => void = () => undefined;
  let written: number | null = null;
  let rounds = 0;
  const round = (hasFocus: boolean) => {
    if (!hasFocus) {
      onSettled(false);
      return;
    }
    // Compare against the target, not against what the last write left: right after mount
    // the browser clamps the write to CodeMirror's estimated height, and a clamped position
    // that merely stays put is not the restored one (T-149). Within a pixel, because
    // scrollTop is fractional on scaled displays.
    if (written !== null && scroller.scrollTop === written && Math.abs(written - top) <= 1) {
      onSettled(true);
      return;
    }
    scroller.scrollTop = top;
    written = scroller.scrollTop;
    rounds += 1;
    if (rounds >= maxRounds) {
      onSettled(true);
      return;
    }
    cancel = afterMeasure(round);
  };
  cancel = afterMeasure(round);
  return () => cancel();
}
