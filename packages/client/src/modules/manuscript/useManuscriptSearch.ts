import { type MutableRefObject, useEffect, useMemo, useRef, useState } from "react";
import type { TextSearchTarget } from "../../shared";
import { useLatest } from "../../shared/hooks/useLatest";
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
  // Read only, and only by the target effects below, which must not re-run when these change.
  const latestChaptersRef = useLatest(chapters);
  const onCurrentIdRef = useLatest(onCurrentId);
  const latestCurrentIdRef = useLatest(current?.id);
  const matches = useMemo(() => manuscriptSearchMatches(chapters, query), [chapters, query]);
  // The active match stays inside the results when they shrink. Adjusted during render, so a
  // result list is never painted with an index past its end.
  const lastMatchIndex = Math.max(0, matches.length - 1);
  if (query && activeIndex > lastMatchIndex) setActiveIndex(lastMatchIndex);
  const activeMatch = matches[activeIndex] ?? null;
  const currentMatches = useMemo(
    () => matches.filter((match) => match.chapterId === current?.id),
    [matches, current?.id],
  );

  const firstTargetRun = useRef(true);
  useEffect(() => {
    void targetRequestId;
    const isFirstRun = firstTargetRun.current;
    firstTargetRun.current = false;
    if (targetId && latestChaptersRef.current.some((chapter) => chapter.id === targetId)) {
      // A target that is already set when the workspace mounts moves away from the chapter
      // that was just loaded; T-69 traces it as a candidate for an unexpected chapter switch.
      if (isFirstRun && latestCurrentIdRef.current && latestCurrentIdRef.current !== targetId) {
        console.warn("[quiltor] chapter switched after load", {
          from: latestCurrentIdRef.current,
          to: targetId,
          at: new Date().toISOString(),
        });
      }
      onCurrentIdRef.current(targetId);
    }
  }, [targetId, targetRequestId]);

  // A requested text search (a world backlink, a search hit) becomes the query and the active
  // match. Handled during render, keyed on the request's values rather than on the object's
  // identity: a parent that rebuilds the object each render would otherwise reset what the
  // author has typed into the search field on every keystroke.
  const requestedQuery = textSearch?.query.trim() ?? "";
  const requestKey =
    requestedQuery && targetId && textSearch
      ? `${targetRequestId ?? ""}\u0000${targetId}\u0000${requestedQuery}\u0000${textSearch.from}\u0000${textSearch.to}`
      : "";
  const [appliedRequestKey, setAppliedRequestKey] = useState("");
  if (requestKey !== appliedRequestKey) {
    setAppliedRequestKey(requestKey);
    if (requestKey && textSearch) {
      const requested = manuscriptSearchMatches(chapters, requestedQuery).findIndex(
        (match) =>
          match.chapterId === targetId &&
          match.from === textSearch.from &&
          match.to === textSearch.to,
      );
      setQuery(requestedQuery);
      setActiveIndex(requested >= 0 ? requested : 0);
    }
  }
  // Opening the requested chapter reaches the owner, which a render must not do.
  useEffect(() => {
    void targetRequestId;
    if (!requestKey || !targetId) return;
    if (latestChaptersRef.current.some((chapter) => chapter.id === targetId)) {
      onCurrentIdRef.current(targetId);
    }
  }, [requestKey, targetId, targetRequestId]);

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
