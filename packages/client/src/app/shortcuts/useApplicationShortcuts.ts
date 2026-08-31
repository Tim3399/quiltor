import { useEffect } from "react";
import type { Workspace } from "../../shared";

export function useApplicationShortcuts({
  focus,
  setFocus,
  openOverlay,
  flushAll,
  workspace,
  undoManuscript,
  redoManuscript,
  undoFigures,
  redoFigures,
  undoStoryboards,
  redoStoryboards,
}: {
  focus: boolean;
  setFocus: (focus: boolean) => void;
  openOverlay: (overlay: "palette" | "snapshot") => void;
  flushAll: () => Promise<void>;
  workspace: Workspace;
  undoManuscript: () => void;
  redoManuscript: () => void;
  undoFigures: () => void;
  redoFigures: () => void;
  undoStoryboards: () => void;
  redoStoryboards: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (event.key === "Escape" && focus) {
        event.preventDefault();
        setFocus(false);
        return;
      }
      if (modifier && event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        openOverlay("snapshot");
        return;
      }
      if (modifier && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void flushAll();
        return;
      }
      if (modifier && (event.key.toLowerCase() === "f" || event.key.toLowerCase() === "k")) {
        event.preventDefault();
        openOverlay("palette");
      }
      const inField = /input|textarea|select/i.test((event.target as HTMLElement)?.tagName || "");
      if (modifier && !inField && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (workspace === "text") event.shiftKey ? redoManuscript() : undoManuscript();
        else if (workspace === "storyboard") event.shiftKey ? redoStoryboards() : undoStoryboards();
        else event.shiftKey ? redoFigures() : undoFigures();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    flushAll,
    focus,
    openOverlay,
    redoFigures,
    redoManuscript,
    redoStoryboards,
    setFocus,
    undoFigures,
    undoManuscript,
    undoStoryboards,
    workspace,
  ]);
}
