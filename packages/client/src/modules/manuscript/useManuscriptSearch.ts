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
  latestChapters.current = chapters;
  onCurrentIdRef.current = onCurrentId;
  const matches = useMemo(() => manuscriptSearchMatches(chapters, query), [chapters, query]);
  const activeMatch = matches[activeIndex] ?? null;
  const currentMatches = useMemo(
    () => matches.filter((match) => match.chapterId === current?.id),
    [matches, current?.id],
  );

  useEffect(() => {
    void targetRequestId;
    if (targetId && latestChapters.current.some((chapter) => chapter.id === targetId))
      onCurrentIdRef.current(targetId);
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
    setQuery(requestedQuery);
    setActiveIndex(requested >= 0 ? requested : 0);
    if (requestedChapters.some((chapter) => chapter.id === targetId))
      onCurrentIdRef.current(targetId);
  }, [targetId, targetRequestId, textSearch]);

  useEffect(() => {
    if (!query) return;
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
