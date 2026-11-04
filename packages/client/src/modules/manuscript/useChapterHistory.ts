import { useEffect, useMemo, useState } from "react";
import { quiltorClient, type SnapshotChapterRecord } from "../../platform";
import { diffVersion, type SnapshotInfo } from "../history";
import type { Chapter } from "./model";

export type ChapterHistoryState = "idle" | "loading" | "error";

export function useChapterHistory(current: Chapter | undefined) {
  const currentId = current?.id;
  const [open, setOpen] = useState(false);
  const [commits, setCommits] = useState<SnapshotInfo[]>([]);
  const [selectedRef, setSelectedRef] = useState("");
  const [selected, setSelected] = useState<SnapshotChapterRecord | null>(null);
  const [previous, setPrevious] = useState<SnapshotChapterRecord | null>(null);
  const [comparisonKey, setComparisonKey] = useState("");
  const [loadedChapterId, setLoadedChapterId] = useState("");
  const [state, setState] = useState<ChapterHistoryState>("idle");
  const requestedKey = selectedRef && currentId ? `${selectedRef}\u0000${currentId}` : "";
  const snapshotReady = Boolean(
    requestedKey && comparisonKey === requestedKey && selected?.available,
  );
  const displayedSelected = loadedChapterId === currentId ? selected : null;
  const displayedPrevious = loadedChapterId === currentId ? previous : null;
  const setHistoryOpen = (next: boolean) => {
    if (next) {
      setCommits([]);
      setSelectedRef("");
      setSelected(null);
      setPrevious(null);
      setComparisonKey("");
      setLoadedChapterId("");
      setState("loading");
    }
    setOpen(next);
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // The reset belongs to opening and lives in setHistoryOpen; this effect only fetches the log.
    void quiltorClient.application.history
      .log()
      .then((result) => {
        if (cancelled) return;
        setCommits(result.commits);
        setSelectedRef(result.commits[0]?.hash || "");
        if (!result.commits.length) setState("idle");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // A new snapshot, chapter or open state invalidates the loaded comparison. Adjusted during
  // render, so no frame shows the previous chapter's comparison under the new one: the key is
  // cleared, a comparison of another chapter is dropped, and a load that is about to start
  // reads as loading.
  const comparisonSource = `${open}\u0000${selectedRef}\u0000${currentId ?? ""}`;
  const [syncedSource, setSyncedSource] = useState(comparisonSource);
  if (syncedSource !== comparisonSource) {
    setSyncedSource(comparisonSource);
    setComparisonKey("");
    if (loadedChapterId !== currentId) {
      setSelected(null);
      setPrevious(null);
      setLoadedChapterId("");
    }
    if (open && selectedRef && currentId !== undefined) setState("loading");
  }

  useEffect(() => {
    if (!open || !selectedRef || currentId === undefined) return;
    let cancelled = false;
    const requestKey = `${selectedRef}\u0000${currentId}`;
    const timeout = window.setTimeout(() => {
      void quiltorClient.application.history
        .chapterComparison(selectedRef, currentId)
        .then((result) => {
          if (cancelled) return;
          if (!result.selected.available) throw new Error("Selected snapshot is unavailable");
          setSelected(result.selected);
          setPrevious(result.previous);
          setComparisonKey(requestKey);
          setLoadedChapterId(currentId);
          setState("idle");
        })
        .catch(() => {
          if (!cancelled) setState("error");
        });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [open, selectedRef, currentId]);

  const projection = useMemo(
    () =>
      snapshotReady && displayedSelected && displayedPrevious?.available
        ? diffVersion(
            displayedPrevious.text,
            displayedSelected.text,
            displayedPrevious.marks,
            displayedSelected.marks,
          )
        : null,
    [displayedPrevious, displayedSelected, snapshotReady],
  );

  return {
    open,
    setOpen: setHistoryOpen,
    commits,
    selectedRef,
    setSelectedRef,
    selected: displayedSelected,
    previous: displayedPrevious,
    snapshotReady,
    projection,
    state,
  };
}
