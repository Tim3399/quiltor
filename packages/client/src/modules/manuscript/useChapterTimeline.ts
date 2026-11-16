import { useCallback, useEffect, useRef, useState } from "react";
import { type ChapterTimelineEntry, quiltorClient } from "../../platform";

export type ChapterTimelineState = "idle" | "loading" | "error";

/** Versions read per page; the server allows 1 to 50. */
export const CHAPTER_TIMELINE_PAGE = 20;

/** The selection the timeline shares with the version comparison (`useChapterHistory`). */
export interface ChapterTimelineSelection {
  selectedRef: string;
  setSelectedRef: (ref: string) => void;
}

/**
 * The versions that changed one chapter, newest first, a page at a time (T-86).
 *
 * Choosing a version goes through the shared selection, so the editor shows the same pair
 * diff as the single-version view. A change of chapter, or closing, aborts the running
 * request and drops its answer: a late page of the previous chapter never lands in this one.
 */
export function useChapterTimeline(
  chapterId: string | undefined,
  enabled: boolean,
  selection: ChapterTimelineSelection,
) {
  const [entries, setEntries] = useState<ChapterTimelineEntry[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<ChapterTimelineState>(
    enabled && chapterId !== undefined ? "loading" : "idle",
  );
  const request = useRef<AbortController | null>(null);

  // One page at a time: loadMore and retry wait while one runs, and the effect's cleanup
  // aborts it on a chapter change or close.
  const load = useCallback((id: string, before: string | null) => {
    const controller = new AbortController();
    request.current = controller;
    void quiltorClient.application.history
      .chapterTimeline(id, {
        limit: CHAPTER_TIMELINE_PAGE,
        ...(before ? { before } : {}),
        signal: controller.signal,
      })
      .then((page) => {
        if (controller.signal.aborted) return;
        setEntries((shown) => (before ? [...shown, ...page.entries] : page.entries));
        setSkipped((counted) => (before ? counted + page.skipped : page.skipped));
        setNext(page.next);
        setState("idle");
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("error");
      });
  }, []);

  // Another chapter, or opening and closing, starts over. Adjusted during render like
  // useChapterHistory, so no frame shows the previous chapter's versions under this one.
  const source = `${enabled}\u0000${chapterId ?? ""}`;
  const [syncedSource, setSyncedSource] = useState(source);
  if (syncedSource !== source) {
    setSyncedSource(source);
    setEntries([]);
    setSkipped(0);
    setNext(null);
    setState(enabled && chapterId !== undefined ? "loading" : "idle");
  }

  useEffect(() => {
    if (!enabled || chapterId === undefined) return;
    load(chapterId, null);
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [chapterId, enabled, load]);

  const loadMore = useCallback(() => {
    if (!enabled || chapterId === undefined || next === null || state === "loading") return;
    setState("loading");
    load(chapterId, next);
  }, [chapterId, enabled, load, next, state]);

  const retry = useCallback(() => {
    if (!enabled || chapterId === undefined || state === "loading") return;
    setState("loading");
    if (entries.length && next !== null) load(chapterId, next);
    else load(chapterId, null);
  }, [chapterId, enabled, entries.length, load, next, state]);

  return {
    entries,
    skipped,
    hasMore: next !== null,
    loadMore,
    retry,
    state,
    selectedRef: selection.selectedRef,
    select: selection.setSelectedRef,
  };
}
