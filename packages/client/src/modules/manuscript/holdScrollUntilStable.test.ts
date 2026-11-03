import { describe, expect, it, vi } from "vitest";
import { holdScrollUntilStable } from "./holdScrollUntilStable";

/** Measure cycles run on demand; `corrections` shift the scroll like a late CodeMirror height fix. */
function measureCycles(scroller: { scrollTop: number }, corrections: number[]) {
  const queue: ((hasFocus: boolean) => void)[] = [];
  let cycle = 0;
  return {
    afterMeasure: (callback: (hasFocus: boolean) => void) => {
      queue.push(callback);
      return () => {
        const index = queue.indexOf(callback);
        if (index >= 0) queue.splice(index, 1);
      };
    },
    /** CodeMirror measures on its own, so a correction lands whether anyone waits for it or not. */
    runAll(hasFocus = true) {
      while (queue.length || cycle < corrections.length) {
        scroller.scrollTop += corrections[cycle] ?? 0;
        cycle += 1;
        queue.shift()?.(hasFocus);
      }
    },
  };
}

describe("restoring the editor scroll position", () => {
  it("writes the position again when a later measure moves it by a line", () => {
    const scroller = { scrollTop: 3765 };
    // First measure leaves the provisional viewport, the second one corrects heights by -17 px.
    const cycles = measureCycles(scroller, [0, -17]);
    const onSettled = vi.fn();
    holdScrollUntilStable({ scroller, top: 5880, afterMeasure: cycles.afterMeasure, onSettled });
    cycles.runAll();
    expect(scroller.scrollTop).toBe(5880);
    expect(onSettled).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("writes the position again when the first write was clamped to an estimated height", () => {
    // The browser clamps scrollTop to the scrollable height. Right after the editor mounts,
    // that height is CodeMirror's estimate and can be too short (T-149: 3455 instead of 3622);
    // the real height only arrives with a later measure.
    let maxTop = 3455;
    let top = 0;
    const scroller = {
      get scrollTop() {
        return top;
      },
      set scrollTop(value: number) {
        top = Math.min(value, maxTop);
      },
    };
    const queue: ((hasFocus: boolean) => void)[] = [];
    const onSettled = vi.fn();
    holdScrollUntilStable({
      scroller,
      top: 3622,
      afterMeasure: (callback) => {
        queue.push(callback);
        return () => undefined;
      },
      onSettled,
    });
    queue.shift()?.(true);
    maxTop = 6245;
    while (queue.length) queue.shift()?.(true);
    expect(scroller.scrollTop).toBe(3622);
    expect(onSettled).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("settles after one quiet cycle when nothing moves", () => {
    const scroller = { scrollTop: 0 };
    const cycles = measureCycles(scroller, []);
    const afterMeasure = vi.fn(cycles.afterMeasure);
    const onSettled = vi.fn();
    holdScrollUntilStable({ scroller, top: 400, afterMeasure, onSettled });
    cycles.runAll();
    expect(scroller.scrollTop).toBe(400);
    expect(afterMeasure).toHaveBeenCalledTimes(2);
    expect(onSettled).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("gives up after the round limit when the layout never settles", () => {
    const scroller = { scrollTop: 0 };
    const cycles = measureCycles(
      scroller,
      Array.from({ length: 6 }, () => -17),
    );
    const onSettled = vi.fn();
    holdScrollUntilStable({
      scroller,
      top: 400,
      afterMeasure: cycles.afterMeasure,
      onSettled,
      maxRounds: 4,
    });
    cycles.runAll();
    expect(onSettled).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("stops without writing when the editor lost focus", () => {
    const scroller = { scrollTop: 10 };
    const cycles = measureCycles(scroller, []);
    const onSettled = vi.fn();
    holdScrollUntilStable({ scroller, top: 400, afterMeasure: cycles.afterMeasure, onSettled });
    cycles.runAll(false);
    expect(scroller.scrollTop).toBe(10);
    expect(onSettled).toHaveBeenCalledExactlyOnceWith(false);
  });
});
