import { useEffect } from "react";

/** Runs `load` once any pending autosave (`flush`) has landed -- the common "flush,
 * then fetch fresh server state" pattern used by dialogs that read from the backend
 * on open (history, snapshot, backups), so a save made just before opening isn't missed. */
export function useFlushedEffect(flush: () => Promise<void>, load: () => void | Promise<void>) {
  useEffect(() => {
    void flush().then(load);
  }, [flush]);
}
