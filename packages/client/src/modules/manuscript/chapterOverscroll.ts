export type ChapterOverscrollDirection = "top" | "bottom";

export interface ChapterOverscrollState {
  direction: ChapterOverscrollDirection | null;
  startedAt: number | null;
  lastInputAt: number | null;
  progress: number;
  triggered: boolean;
}

export interface ChapterOverscrollInput {
  direction: ChapterOverscrollDirection;
  now: number;
  hasTarget: boolean;
}

export interface ChapterOverscrollTransition {
  state: ChapterOverscrollState;
  navigate: ChapterOverscrollDirection | null;
}

export const CHAPTER_OVERSCROLL_HOLD_MS = 425;
// A wheel event does not say whether a hand or a trackpad produced it, and a trackpad keeps
// sending them long after the fingers have left the glass. A short quiet gap is the only thing
// that reliably separates two gestures, so that is where one physical stream is taken to end.
export const CHAPTER_WHEEL_STREAM_GAP_MS = 160;
// A mouse wheel has to be re-gripped between quick rotations. Keep the accumulated intent long
// enough for that natural pause without allowing a lone boundary event to navigate.
export const CHAPTER_OVERSCROLL_REGRIP_GRACE_MS = 650;

export function idleChapterOverscroll(): ChapterOverscrollState {
  return {
    direction: null,
    startedAt: null,
    lastInputAt: null,
    progress: 0,
    triggered: false,
  };
}

/**
 * Advances a deliberate chapter-boundary gesture. The caller supplies monotonic timestamps so
 * the transition stays independent of browser timers.
 *
 * This is the wheel's policy: it measures a gesture in time, because a wheel at the edge has
 * nothing else to measure. A finger is measured in distance instead -- see `chapterTouchTurn.ts`.
 */
export function advanceChapterOverscroll(
  state: ChapterOverscrollState,
  input: ChapterOverscrollInput,
): ChapterOverscrollTransition {
  if (!input.hasTarget) return resetTransition();

  if (state.direction !== null && state.direction !== input.direction) {
    return resetTransition();
  }

  const inactive =
    state.lastInputAt !== null &&
    (input.now < state.lastInputAt ||
      input.now - state.lastInputAt > CHAPTER_OVERSCROLL_REGRIP_GRACE_MS);
  if (state.direction === null || state.startedAt === null || inactive) {
    return {
      state: {
        direction: input.direction,
        startedAt: input.now,
        lastInputAt: input.now,
        progress: 0,
        triggered: false,
      },
      navigate: null,
    };
  }

  if (state.triggered) {
    return {
      state: { ...state, lastInputAt: input.now, progress: 1 },
      navigate: null,
    };
  }

  const progress = Math.min(
    1,
    Math.max(0, (input.now - state.startedAt) / CHAPTER_OVERSCROLL_HOLD_MS),
  );
  const triggered = progress >= 1;
  return {
    state: {
      ...state,
      lastInputAt: input.now,
      progress,
      triggered,
    },
    navigate: triggered ? input.direction : null,
  };
}

function resetTransition(): ChapterOverscrollTransition {
  return { state: idleChapterOverscroll(), navigate: null };
}
