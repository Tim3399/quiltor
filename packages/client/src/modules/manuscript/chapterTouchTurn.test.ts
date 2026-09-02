import { describe, expect, it } from "vitest";
import type { ChapterOverscrollDirection } from "./chapterOverscroll";
import {
  advanceChapterTouch,
  beginChapterTouch,
  CHAPTER_TOUCH_THRESHOLD_PX,
  chapterTouchNavigation,
  type ChapterTouchState,
} from "./chapterTouchTurn";

type HasTarget = (direction: ChapterOverscrollDirection) => boolean;

const both: HasTarget = () => true;
const neither: HasTarget = () => false;
const only =
  (allowed: ChapterOverscrollDirection): HasTarget =>
  (direction) =>
    direction === allowed;

const AT_TOP = { atTop: true, atBottom: false };
const AT_BOTTOM = { atTop: false, atBottom: true };
const MIDWAY = { atTop: false, atBottom: false };

function pull(
  from: { atTop: boolean; atBottom: boolean },
  moves: Array<{ dx?: number; dy: number; edges?: { atTop: boolean; atBottom: boolean } }>,
  hasTarget: HasTarget = both,
): ChapterTouchState {
  let state = beginChapterTouch({ x: 100, y: 400, ...from });
  for (const move of moves) {
    state = advanceChapterTouch(
      state,
      { x: 100 + (move.dx ?? 0), y: 400 + move.dy, ...(move.edges ?? from) },
      hasTarget,
    );
  }
  return state;
}

describe("turning a chapter with a finger", () => {
  it("turns back a page when a long pull down at the top is released", () => {
    const state = pull(AT_TOP, [{ dy: 30 }, { dy: CHAPTER_TOUCH_THRESHOLD_PX }]);
    expect(state.direction).toBe("top");
    expect(state.progress).toBe(1);
    expect(chapterTouchNavigation(state)).toBe("top");
  });

  it("turns forward a page when a long pull up at the bottom is released", () => {
    const state = pull(AT_BOTTOM, [{ dy: -CHAPTER_TOUCH_THRESHOLD_PX }]);
    expect(state.direction).toBe("bottom");
    expect(chapterTouchNavigation(state)).toBe("bottom");
  });

  it("does nothing for a pull that stops short", () => {
    const state = pull(AT_TOP, [{ dy: CHAPTER_TOUCH_THRESHOLD_PX - 1 }]);
    expect(state.direction).toBe("top");
    expect(state.progress).toBeLessThan(1);
    expect(chapterTouchNavigation(state)).toBeNull();
  });

  it("reports how far a pull has come so the page can show it", () => {
    const state = pull(AT_TOP, [{ dy: CHAPTER_TOUCH_THRESHOLD_PX / 2 }]);
    expect(state.progress).toBeCloseTo(0.5);
  });

  it("gives up when the finger turns back on itself", () => {
    const state = pull(AT_TOP, [{ dy: CHAPTER_TOUCH_THRESHOLD_PX }, { dy: -10 }]);
    expect(state.abandoned).toBe(true);
    expect(chapterTouchNavigation(state)).toBeNull();
  });

  it("stays given up on once the finger has turned back, however far it pulls after", () => {
    const state = pull(AT_TOP, [{ dy: 40 }, { dy: -10 }, { dy: CHAPTER_TOUCH_THRESHOLD_PX * 2 }]);
    expect(chapterTouchNavigation(state)).toBeNull();
  });

  it("ignores a swipe that runs more sideways than up or down", () => {
    const state = pull(AT_TOP, [{ dx: 120, dy: CHAPTER_TOUCH_THRESHOLD_PX + 10 }]);
    expect(state.abandoned).toBe(true);
    expect(chapterTouchNavigation(state)).toBeNull();
  });

  it("never starts from the middle of a chapter, however the scroll ends up", () => {
    const state = pull(MIDWAY, [{ dy: CHAPTER_TOUCH_THRESHOLD_PX * 2, edges: AT_TOP }]);
    expect(state.abandoned).toBe(true);
    expect(chapterTouchNavigation(state)).toBeNull();
  });

  it("gives up when the surface leaves the edge the pull started at", () => {
    const state = pull(AT_BOTTOM, [
      { dy: -20 },
      { dy: -CHAPTER_TOUCH_THRESHOLD_PX, edges: MIDWAY },
    ]);
    expect(chapterTouchNavigation(state)).toBeNull();
  });

  it("stays idle when there is no chapter in that direction", () => {
    const state = pull(AT_TOP, [{ dy: CHAPTER_TOUCH_THRESHOLD_PX }], neither);
    expect(state.direction).toBeNull();
    expect(chapterTouchNavigation(state)).toBeNull();
  });

  it("stays idle for the one direction that has nowhere to go", () => {
    const forwards = pull(AT_BOTTOM, [{ dy: -CHAPTER_TOUCH_THRESHOLD_PX }], only("top"));
    expect(chapterTouchNavigation(forwards)).toBeNull();
    const backwards = pull(AT_TOP, [{ dy: CHAPTER_TOUCH_THRESHOLD_PX }], only("top"));
    expect(chapterTouchNavigation(backwards)).toBe("top");
  });

  it("treats a finger that has not moved as no gesture yet", () => {
    const state = pull(AT_TOP, [{ dy: 0 }]);
    expect(state.direction).toBeNull();
    expect(state.abandoned).toBe(false);
    expect(chapterTouchNavigation(state)).toBeNull();
  });
});
