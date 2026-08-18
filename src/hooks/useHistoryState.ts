import { useCallback, useRef, useState } from "react";

// Edits within this window of each other coalesce into one undo step, so holding a key
// down or typing a quick burst doesn't fill the undo stack with single-character entries.
const COALESCE_WINDOW_MS = 650;
const MAX_HISTORY_ENTRIES = 80;

export function useHistoryState<T>() {
  const [value, setValue] = useState<T | null>(null);
  const [, setTimelineVersion] = useState(0);
  const past = useRef<T[]>([]),
    future = useRef<T[]>([]),
    last = useRef(0);
  const load = useCallback((next: T) => {
    past.current = [];
    future.current = [];
    setValue(next);
    setTimelineVersion((value) => value + 1);
  }, []);
  const change = useCallback((next: T) => {
    setValue((current) => {
      if (current) {
        const now = Date.now();
        if (now - last.current > COALESCE_WINDOW_MS) past.current.push(current);
        if (past.current.length > MAX_HISTORY_ENTRIES) past.current.shift();
        last.current = now;
        future.current = [];
      }
      return next;
    });
    setTimelineVersion((value) => value + 1);
  }, []);
  const undo = useCallback(() => {
    setValue((current) => {
      if (!current || !past.current.length) return current;
      const previous = past.current.pop()!;
      future.current.push(current);
      return previous;
    });
    setTimelineVersion((value) => value + 1);
  }, []);
  const redo = useCallback(() => {
    setValue((current) => {
      if (!current || !future.current.length) return current;
      const next = future.current.pop()!;
      past.current.push(current);
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
