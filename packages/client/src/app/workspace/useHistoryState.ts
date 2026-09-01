import { useCallback, useRef, useState } from "react";

const COALESCE_WINDOW_MS = 650;
const MAX_HISTORY_ENTRIES = 80;

export interface HistoryChangeOptions {
  separateHistoryStep?: boolean;
}

export function useHistoryState<T>() {
  const [value, setValue] = useState<T | null>(null);
  const [, setTimelineVersion] = useState(0);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const last = useRef(0);
  const startNewHistoryStep = useRef(true);
  const load = useCallback((next: T) => {
    past.current = [];
    future.current = [];
    last.current = 0;
    startNewHistoryStep.current = true;
    setValue(next);
    setTimelineVersion((value) => value + 1);
  }, []);
  const change = useCallback((next: T, options?: HistoryChangeOptions) => {
    setValue((current) => {
      if (current !== null) {
        const now = Date.now();
        const isSeparateHistoryStep = options?.separateHistoryStep === true;
        if (
          isSeparateHistoryStep ||
          startNewHistoryStep.current ||
          now - last.current > COALESCE_WINDOW_MS
        ) {
          past.current.push(current);
        }
        if (past.current.length > MAX_HISTORY_ENTRIES) past.current.shift();
        last.current = now;
        startNewHistoryStep.current = isSeparateHistoryStep;
        future.current = [];
      }
      return next;
    });
    setTimelineVersion((value) => value + 1);
  }, []);
  const undo = useCallback(() => {
    setValue((current) => {
      if (current === null || !past.current.length) return current;
      const previousIndex = past.current.length - 1;
      const previous = past.current[previousIndex];
      past.current.splice(previousIndex, 1);
      future.current.push(current);
      startNewHistoryStep.current = true;
      return previous;
    });
    setTimelineVersion((value) => value + 1);
  }, []);
  const redo = useCallback(() => {
    setValue((current) => {
      if (current === null || !future.current.length) return current;
      const nextIndex = future.current.length - 1;
      const next = future.current[nextIndex];
      future.current.splice(nextIndex, 1);
      past.current.push(current);
      startNewHistoryStep.current = true;
      return next;
    });
    setTimelineVersion((value) => value + 1);
  }, []);
  return {
    value,
    load,
    change,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}
