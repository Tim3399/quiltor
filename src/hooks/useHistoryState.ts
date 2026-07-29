import { useCallback, useRef, useState } from 'react';

export function useHistoryState<T>() {
  const [value, setValue] = useState<T | null>(null);
  const [, setTimelineVersion] = useState(0);
  const past = useRef<T[]>([]), future = useRef<T[]>([]), last = useRef(0);
  const load = useCallback((next: T) => { past.current = []; future.current = []; setValue(next); setTimelineVersion(value => value + 1); }, []);
  const change = useCallback((next: T) => {
    setValue(current => {
      if (current) {
        const now = Date.now();
        if (now - last.current > 650) past.current.push(current);
        if (past.current.length > 80) past.current.shift();
        last.current = now; future.current = [];
      }
      return next;
    });
    setTimelineVersion(value => value + 1);
  }, []);
  const undo = useCallback(() => { setValue(current => { if (!current || !past.current.length) return current; const previous = past.current.pop()!; future.current.push(current); return previous; }); setTimelineVersion(value => value + 1); }, []);
  const redo = useCallback(() => { setValue(current => { if (!current || !future.current.length) return current; const next = future.current.pop()!; past.current.push(current); return next; }); setTimelineVersion(value => value + 1); }, []);
  return { value, load, change, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}
