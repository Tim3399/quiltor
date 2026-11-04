import { useCallback, useReducer } from "react";

const COALESCE_WINDOW_MS = 650;
const MAX_HISTORY_ENTRIES = 80;

export interface HistoryChangeOptions {
  separateHistoryStep?: boolean;
}

/**
 * The whole history lives in one state value, so availability (`canUndo`, `canRedo`) is read
 * from state like any other value and the reducer stays pure: the clock is read by `change`
 * and handed in with the action.
 */
interface HistoryState<T> {
  value: T | null;
  past: T[];
  future: T[];
  /** When the last change was recorded; fast typing within the window shares one step. */
  last: number;
  /** The next change opens a step of its own (after a load, an undo/redo, a discrete step). */
  startNewStep: boolean;
}

type HistoryAction<T> =
  | { type: "load"; value: T }
  | { type: "clear" }
  | { type: "change"; value: T; now: number; separate: boolean }
  | { type: "undo" }
  | { type: "redo" };

function emptyHistory<T>(value: T | null): HistoryState<T> {
  return { value, past: [], future: [], last: 0, startNewStep: true };
}

function reduce<T>(state: HistoryState<T>, action: HistoryAction<T>): HistoryState<T> {
  switch (action.type) {
    case "load":
      return emptyHistory(action.value);
    case "clear":
      return emptyHistory<T>(null);
    case "change": {
      if (state.value === null) return { ...state, value: action.value };
      const opensStep =
        action.separate || state.startNewStep || action.now - state.last > COALESCE_WINDOW_MS;
      const past = opensStep ? [...state.past, state.value] : state.past;
      return {
        value: action.value,
        past: past.length > MAX_HISTORY_ENTRIES ? past.slice(1) : past,
        future: [],
        last: action.now,
        startNewStep: action.separate,
      };
    }
    case "undo": {
      if (state.value === null || !state.past.length) return state;
      return {
        ...state,
        value: state.past[state.past.length - 1],
        past: state.past.slice(0, -1),
        future: [...state.future, state.value],
        startNewStep: true,
      };
    }
    case "redo": {
      if (state.value === null || !state.future.length) return state;
      return {
        ...state,
        value: state.future[state.future.length - 1],
        past: [...state.past, state.value],
        future: state.future.slice(0, -1),
        startNewStep: true,
      };
    }
  }
}

export function useHistoryState<T>() {
  const [state, dispatch] = useReducer(reduce<T>, null, () => emptyHistory<T>(null));
  const load = useCallback((next: T) => dispatch({ type: "load", value: next }), []);
  // Forget the documents entirely, so no undo can bring back a world that is no longer open.
  const clear = useCallback(() => dispatch({ type: "clear" }), []);
  const change = useCallback(
    (next: T, options?: HistoryChangeOptions) =>
      dispatch({
        type: "change",
        value: next,
        now: Date.now(),
        separate: options?.separateHistoryStep === true,
      }),
    [],
  );
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  return {
    value: state.value,
    load,
    clear,
    change,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
