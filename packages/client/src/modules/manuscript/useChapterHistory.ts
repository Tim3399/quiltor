import { useEffect, useMemo, useRef, useState } from "react";
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
  const loadedChapterIdRef = useRef("");
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
      loadedChapterIdRef.current = "";
      setLoadedChapterId("");
      setState("loading");
    }
    setOpen(next);
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCommits([]);
    setSelectedRef("");
    setSelected(null);
    setPrevious(null);
    setComparisonKey("");
    loadedChapterIdRef.current = "";
    setLoadedChapterId("");
    setState("loading");
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

  useEffect(() => {
    setComparisonKey("");
    if (loadedChapterIdRef.current !== currentId) {
      setSelected(null);
      setPrevious(null);
      setLoadedChapterId("");
    }
    if (!open || !selectedRef || currentId === undefined) return;
    setState("loading");
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
          loadedChapterIdRef.current = currentId;
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
