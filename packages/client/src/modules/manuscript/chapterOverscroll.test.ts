import { describe, expect, it } from "vitest";
import {
  advanceChapterOverscroll,
  CHAPTER_OVERSCROLL_HOLD_MS,
  CHAPTER_OVERSCROLL_REGRIP_GRACE_MS,
  type ChapterOverscrollDirection,
  type ChapterOverscrollState,
  idleChapterOverscroll,
} from "./chapterOverscroll";

function advance(
  state: ChapterOverscrollState,
  direction: ChapterOverscrollDirection,
  now: number,
  hasTarget = true,
) {
  return advanceChapterOverscroll(state, { direction, now, hasTarget });
}

describe("chapter overscroll navigation", () => {
  it.each(["top", "bottom"] as const)("starts %s input without navigating", (direction) => {
    const transition = advance(idleChapterOverscroll(), direction, 12_000);

    expect(transition.navigate).toBeNull();
    expect(transition.state).toMatchObject({
      direction,
      startedAt: 12_000,
      progress: 0,
      triggered: false,
    });
  });

  it("requires sustained input for the full hold duration", () => {
    let state = advance(idleChapterOverscroll(), "bottom", 1_000).state;

    for (const elapsed of [150, 300, 450, 600, 750, CHAPTER_OVERSCROLL_HOLD_MS - 1]) {
      const transition = advance(state, "bottom", 1_000 + elapsed);
      expect(transition.navigate).toBeNull();
      state = transition.state;
    }

    const completed = advance(state, "bottom", 1_000 + CHAPTER_OVERSCROLL_HOLD_MS);
    expect(completed.navigate).toBe("bottom");
    expect(completed.state).toMatchObject({ progress: 1, triggered: true });
  });

  it("reports clamped progress while tracking", () => {
    const started = advance(idleChapterOverscroll(), "top", 2_000).state;
    const keptAlive = advance(started, "top", 2_150).state;
    const keptAliveAgain = advance(keptAlive, "top", 2_300).state;
    const halfway = advance(keptAliveAgain, "top", 2_000 + CHAPTER_OVERSCROLL_HOLD_MS / 2);

    expect(halfway.state.progress).toBe(0.5);
    expect(halfway.state.progress).toBeGreaterThanOrEqual(0);
    expect(halfway.state.progress).toBeLessThanOrEqual(1);
  });

  it("cancels when input reverses direction", () => {
    const started = advance(idleChapterOverscroll(), "bottom", 0).state;
    const tracking = advance(started, "bottom", 150).state;
    const reversed = advance(tracking, "top", 300);

    expect(reversed.navigate).toBeNull();
    expect(reversed.state).toEqual(idleChapterOverscroll());

    const restarted = advance(reversed.state, "top", 320);
    expect(restarted.state).toMatchObject({ direction: "top", progress: 0 });
  });

  it("starts over after an inactivity gap", () => {
    const started = advance(idleChapterOverscroll(), "bottom", 0).state;
    const tracking = advance(started, "bottom", 150).state;
    const afterGap = advance(tracking, "bottom", 150 + CHAPTER_OVERSCROLL_REGRIP_GRACE_MS + 1);

    expect(afterGap.navigate).toBeNull();
    expect(afterGap.state).toMatchObject({
      direction: "bottom",
      startedAt: 150 + CHAPTER_OVERSCROLL_REGRIP_GRACE_MS + 1,
      progress: 0,
      triggered: false,
    });
  });

  it("preserves intent across a natural mouse-wheel re-grip pause", () => {
    const started = advance(idleChapterOverscroll(), "bottom", 0).state;
    const firstRotation = advance(started, "bottom", 150).state;
    const afterRegrip = advance(firstRotation, "bottom", 600);

    expect(afterRegrip.navigate).toBeNull();
    expect(afterRegrip.state).toMatchObject({
      direction: "bottom",
      startedAt: 0,
      lastInputAt: 600,
      progress: 600 / CHAPTER_OVERSCROLL_HOLD_MS,
    });
  });

  it("stays idle when there is no chapter in that direction", () => {
    const started = advance(idleChapterOverscroll(), "top", 0, false);
    expect(started).toEqual({ state: idleChapterOverscroll(), navigate: null });

    const tracking = advance(idleChapterOverscroll(), "bottom", 0).state;
    const targetRemoved = advance(tracking, "bottom", CHAPTER_OVERSCROLL_HOLD_MS, false);
    expect(targetRemoved).toEqual({ state: idleChapterOverscroll(), navigate: null });
  });

  it("navigates only once per sustained gesture", () => {
    let state = advance(idleChapterOverscroll(), "top", 0).state;
    for (const now of [150, 300, 450, 600, 750]) state = advance(state, "top", now).state;

    const completed = advance(state, "top", CHAPTER_OVERSCROLL_HOLD_MS);
    const continued = advance(completed.state, "top", CHAPTER_OVERSCROLL_HOLD_MS + 100);

    expect(completed.navigate).toBe("top");
    expect(continued.navigate).toBeNull();
    expect(continued.state).toMatchObject({ progress: 1, triggered: true });
  });
});
