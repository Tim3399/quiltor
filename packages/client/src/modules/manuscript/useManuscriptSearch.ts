import { type MutableRefObject, useEffect, useMemo, useRef, useState } from "react";
import type { TextSearchTarget } from "../../shared";
import type { ManuscriptEditorHandle } from "./ManuscriptEditor";
import type { Chapter } from "./model";
import { manuscriptSearchMatches } from "./search";

interface ManuscriptSearchOptions {
  chapters: Chapter[];
  current?: Chapter;
  targetId?: string;
  targetRequestId?: number;
  textSearch?: TextSearchTarget;
  editor: MutableRefObject<ManuscriptEditorHandle | null>;
  onCurrentId: (id: string) => void;
}

export function useManuscriptSearch({
  chapters,
  current,
  targetId,
  targetRequestId,
  textSearch,
  editor,
  onCurrentId,
}: ManuscriptSearchOptions) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const latestChapters = useRef(chapters);
  const onCurrentIdRef = useRef(onCurrentId);
  const latestCurrentId = useRef(current?.id);
  // eslint-disable-next-line react-hooks/refs -- latest-value ref: callbacks and effects read the newest value without re-subscribing; assigning in an effect would leave it one commit stale
  latestChapters.current = chapters;
  // eslint-disable-next-line react-hooks/refs -- latest-value ref: callbacks and effects read the newest value without re-subscribing; assigning in an effect would leave it one commit stale
  onCurrentIdRef.current = onCurrentId;
  const matches = useMemo(() => manuscriptSearchMatches(chapters, query), [chapters, query]);
  const activeMatch = matches[activeIndex] ?? null;
  const currentMatches = useMemo(
    () => matches.filter((match) => match.chapterId === current?.id),
    [matches, current?.id],
  );

  const firstTargetRun = useRef(true);
  // eslint-disable-next-line react-hooks/refs -- latest-value ref, read by the target effect below
  latestCurrentId.current = current?.id;
  useEffect(() => {
    void targetRequestId;
    const isFirstRun = firstTargetRun.current;
    firstTargetRun.current = false;
    if (targetId && latestChapters.current.some((chapter) => chapter.id === targetId)) {
      // A target that is already set when the workspace mounts moves away from the chapter
      // that was just loaded; T-69 traces it as a candidate for an unexpected chapter switch.
      if (isFirstRun && latestCurrentId.current && latestCurrentId.current !== targetId) {
        console.warn("[quiltor] chapter switched after load", {
          from: latestCurrentId.current,
          to: targetId,
          at: new Date().toISOString(),
        });
      }
      onCurrentIdRef.current(targetId);
    }
  }, [targetId, targetRequestId]);

  useEffect(() => {
    void targetRequestId;
    const requestedSearch = textSearch;
    const requestedQuery = requestedSearch?.query.trim();
    if (!requestedQuery || !targetId || !requestedSearch) return;
    const requestedChapters = latestChapters.current;
    const requestedMatches = manuscriptSearchMatches(requestedChapters, requestedQuery);
    const requested = requestedMatches.findIndex(
      (match) =>
        match.chapterId === targetId &&
        match.from === requestedSearch.from &&
        match.to === requestedSearch.to,
    );
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate state reset or sync when its trigger changes; moving it into render would change when the update lands
    setQuery(requestedQuery);
    setActiveIndex(requested >= 0 ? requested : 0);
    if (requestedChapters.some((chapter) => chapter.id === targetId))
      onCurrentIdRef.current(targetId);
  }, [targetId, targetRequestId, textSearch]);

  useEffect(() => {
    if (!query) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate state reset or sync when its trigger changes; moving it into render would change when the update lands
    setActiveIndex((index) => Math.min(index, Math.max(0, matches.length - 1)));
  }, [matches.length, query]);

  useEffect(() => {
    if (!activeMatch || activeMatch.chapterId !== current?.id) return;
    const frame = requestAnimationFrame(() =>
      editor.current?.reveal(activeMatch.from, activeMatch.to),
    );
    return () => cancelAnimationFrame(frame);
  }, [activeMatch, current?.id, editor]);

  const navigate = (offset: number) => {
    if (!matches.length) return;
    const next = (activeIndex + offset + matches.length) % matches.length;
    setActiveIndex(next);
    onCurrentId(matches[next].chapterId);
  };

  const close = () => {
    setQuery("");
    setActiveIndex(0);
    editor.current?.focus();
  };

  return {
    query,
    activeIndex,
    matches,
    activeMatch,
    currentMatches,
    navigate,
    close,
  };
}
