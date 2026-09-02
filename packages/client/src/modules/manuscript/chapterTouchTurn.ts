/**
 * Turning a chapter with a finger.
 *
 * A wheel gesture is measured in time -- keep pushing at the edge and the page
 * turns. A finger has no equivalent: it is already at the edge the moment it
 * lands, and holding it still means nothing. So this one is measured in
 * distance, the way a pull-to-refresh is: drag past the threshold and let go.
 *
 * Nothing here calls preventDefault, and nothing here decides when to scroll.
 * The gesture only watches: the surface keeps scrolling, selecting and zooming
 * exactly as the browser wants it to, and a turn happens only when the finger
 * lifts after a long pull that started at an edge and never turned back.
 */

import type { ChapterOverscrollDirection } from "./chapterOverscroll";

/** Far enough that it cannot be a mis-swipe, short enough for one thumb. */
export const CHAPTER_TOUCH_THRESHOLD_PX = 72;

export interface ChapterTouchPoint {
  x: number;
  y: number;
  /** Which edges the surface was resting against when this point was sampled. */
  atTop: boolean;
  atBottom: boolean;
}

export interface ChapterTouchState {
  direction: ChapterOverscrollDirection | null;
  originX: number;
  originY: number;
  /** How far the pull has come along its direction, as a fraction of one turn. */
  progress: number;
  /** Once given up on, a gesture stays given up on until the finger lifts. */
  abandoned: boolean;
}

export function idleChapterTouch(): ChapterTouchState {
  return { direction: null, originX: 0, originY: 0, progress: 0, abandoned: false };
}

/** The state a finger landing on the surface starts from. */
export function beginChapterTouch(point: ChapterTouchPoint): ChapterTouchState {
  return {
    direction: null,
    originX: point.x,
    originY: point.y,
    progress: 0,
    // A finger that lands mid-chapter can only ever scroll. Deciding that here
    // means a long scroll cannot become a page turn just because it happens to
    // end at the edge -- the same rule the wheel follows for its own stream.
    abandoned: !point.atTop && !point.atBottom,
  };
}

/**
 * The state after the finger has moved to `point`.
 *
 * A pull is given up on when it turns back on itself, when it drifts more
 * sideways than up or down, when the surface leaves the edge it started at, or
 * when there is no chapter waiting in that direction.
 */
export function advanceChapterTouch(
  state: ChapterTouchState,
  point: ChapterTouchPoint,
  hasTarget: (direction: ChapterOverscrollDirection) => boolean,
): ChapterTouchState {
  if (state.abandoned) return state;
  const dx = point.x - state.originX;
  const dy = point.y - state.originY;
  if (Math.abs(dx) > Math.abs(dy)) return { ...state, progress: 0, abandoned: true };
  if (dy === 0) return { ...state, progress: 0 };

  // Pulling the page down at the top uncovers what came before it.
  const direction: ChapterOverscrollDirection = dy > 0 ? "top" : "bottom";
  if (state.direction !== null && state.direction !== direction) {
    return { ...state, progress: 0, abandoned: true };
  }
  const stillAtEdge = direction === "top" ? point.atTop : point.atBottom;
  if (!stillAtEdge || !hasTarget(direction)) {
    return { ...state, direction: null, progress: 0, abandoned: true };
  }
  return {
    ...state,
    direction,
    progress: Math.min(1, Math.abs(dy) / CHAPTER_TOUCH_THRESHOLD_PX),
  };
}

/** Which chapter the lifted finger asked for, if it asked for one at all. */
export function chapterTouchNavigation(
  state: ChapterTouchState,
): ChapterOverscrollDirection | null {
  if (state.abandoned || state.direction === null || state.progress < 1) return null;
  return state.direction;
}
