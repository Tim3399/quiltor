import {
  type CSSProperties,
  type MutableRefObject,
  type TouchEvent as ReactTouchEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button, EmptyState, ScrollArea, TextArea } from "../../design";
import { useI18n } from "../../i18n";
import type { SnapshotChapterRecord } from "../../platform";
import type { Workspace } from "../../shared";
import type { SnapshotInfo, VersionDiffProjection } from "../history";
import { type FigureNode, type FigureState, kindLabel } from "../story-world";
import { ChapterHistoryPanel } from "./ChapterHistoryPanel";
import { ChapterTurnAffordance, type ChapterTurnTarget } from "./ChapterTurnAffordance";
import {
  advanceChapterOverscroll,
  CHAPTER_OVERSCROLL_REGRIP_GRACE_MS,
  CHAPTER_WHEEL_STREAM_GAP_MS,
  type ChapterOverscrollDirection,
  idleChapterOverscroll,
} from "./chapterOverscroll";
import {
  advanceChapterTouch,
  beginChapterTouch,
  type ChapterTouchState,
  chapterTouchNavigation,
  idleChapterTouch,
} from "./chapterTouchTurn";
import {
  type EditorTextSelection,
  type EditorViewSelection,
  ManuscriptEditor,
  type ManuscriptEditorHandle,
} from "./ManuscriptEditor";
import type { Chapter, EntityMention, TextMark, WritingIssue } from "./model";
import { SearchNavigation } from "./SearchNavigation";
import type { ManuscriptSearchMatch } from "./search";
import type { ChapterHistoryState } from "./useChapterHistory";
import type { ManuscriptEditorSessionState, WorkspaceSelection } from "./workspaceTypes";
import "./EditorSurface.css";

interface EditorSurfaceProps {
  current?: Chapter;
  initialSessionState?: ManuscriptEditorSessionState | null;
  allowSessionRestore?: boolean;
  onSessionStateChange?: (state: ManuscriptEditorSessionState) => void;
  editorRef: MutableRefObject<ManuscriptEditorHandle | null>;
  figures: FigureState;
  vocabulary: string[];
  grammarIssues: WritingIssue[];
  held: { from: number; to: number } | null;
  searchQuery: string;
  searchMatches: ManuscriptSearchMatch[];
  currentSearchMatches: ManuscriptSearchMatch[];
  activeSearchIndex: number;
  activeSearchMatch: ManuscriptSearchMatch | null;
  historyOpen: boolean;
  historyCommits: SnapshotInfo[];
  historyRef: string;
  historicalChapter: SnapshotChapterRecord | null;
  previousHistoricalChapter: SnapshotChapterRecord | null;
  historyProjection: VersionDiffProjection | null;
  historySnapshotReady: boolean;
  historyState: ChapterHistoryState;
  previousChapter?: ChapterTurnTarget;
  nextChapter?: ChapterTurnTarget;
  onCreateChapter: () => void;
  onNavigateChapter: (id: string) => void;
  onUpdateTitle: (title: string) => void;
  onEditorChange: (body: string, mentions: EntityMention[], marks: TextMark[]) => void;
  onSelection: (selection: WorkspaceSelection | null) => void;
  onSelectionMenu: (selection: WorkspaceSelection) => void;
  onIssue: (issue: WritingIssue) => void;
  onOpenEntity?: (target: { workspace: Workspace; id: string }) => void;
  onNavigateSearch: (offset: number) => void;
  onCloseSearch: () => void;
  onCloseHistory: () => void;
  onHistoryRef: (ref: string) => void;
}

function singleLineTitle(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

export function EditorSurface({
  current,
  initialSessionState,
  allowSessionRestore = true,
  onSessionStateChange,
  editorRef,
  figures,
  vocabulary,
  grammarIssues,
  held,
  searchQuery,
  searchMatches,
  currentSearchMatches,
  activeSearchIndex,
  activeSearchMatch,
  historyOpen,
  historyCommits,
  historyRef,
  historicalChapter,
  previousHistoricalChapter,
  historyProjection,
  historySnapshotReady,
  historyState,
  previousChapter,
  nextChapter,
  onCreateChapter,
  onNavigateChapter,
  onUpdateTitle,
  onEditorChange,
  onSelection,
  onSelectionMenu,
  onIssue,
  onOpenEntity,
  onNavigateSearch,
  onCloseSearch,
  onCloseHistory,
  onHistoryRef,
}: EditorSurfaceProps) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const titleCompositionRef = useRef<{ chapterId: string; value: string } | null>(null);
  const pendingTitleSelectionFrameRef = useRef<number | null>(null);
  const restoreRef = useRef(
    allowSessionRestore && initialSessionState?.chapterId === current?.id
      ? initialSessionState
      : null,
  );
  const viewSelectionRef = useRef<{ chapterId: string; selection: EditorViewSelection } | null>(
    null,
  );
  const sessionCallbackRef = useRef(onSessionStateChange);
  const pendingRestoreCancelRef = useRef<(() => void) | null>(null);
  sessionCallbackRef.current = onSessionStateChange;
  const stopScheduledRestore = useCallback(() => {
    pendingRestoreCancelRef.current?.();
    pendingRestoreCancelRef.current = null;
  }, []);
  const abandonSessionRestore = useCallback(() => {
    stopScheduledRestore();
    restoreRef.current = null;
  }, [stopScheduledRestore]);
  const captureSession = useCallback(() => {
    const view = viewSelectionRef.current;
    const scroller = scrollRef.current;
    if (historyOpen || !view || !scroller || view.chapterId !== current?.id) return;
    sessionCallbackRef.current?.({
      chapterId: view.chapterId,
      selection: view.selection,
      scrollTop:
        historyScroll.current?.chapterId === view.chapterId
          ? historyScroll.current.top
          : (restoreRef.current?.scrollTop ?? scroller.scrollTop),
    });
  }, [current?.id, historyOpen]);
  const pendingLandingRef = useRef<{
    chapterId: string;
    edge: "top" | "bottom";
  } | null>(null);
  const chapterOverscrollInactivityRef = useRef<number | null>(null);
  // What the current physical wheel stream is allowed to do, and when it last spoke.
  const chapterWheelStreamRef = useRef<{ lastInputAt: number | null; blocked: boolean }>({
    lastInputAt: null,
    blocked: false,
  });
  const [chapterOverscroll, setChapterOverscroll] = useState(idleChapterOverscroll);
  const [chapterTouch, setChapterTouch] = useState<ChapterTouchState>(idleChapterTouch);
  const [titleComposition, setTitleComposition] = useState<{
    chapterId: string;
    value: string;
  } | null>(null);
  const chapterTouchRef = useRef(chapterTouch);
  const chapterOverscrollRef = useRef(chapterOverscroll);
  const currentChapterId = current?.id;
  const chapterTitle = current?.title;
  const currentChapterIdRef = useRef(currentChapterId);
  currentChapterIdRef.current = currentChapterId;
  const displayedChapterTitle =
    titleComposition && titleComposition.chapterId === currentChapterId
      ? titleComposition.value
      : chapterTitle;
  const chapterNavigationContext = `${currentChapterId ?? ""}:${previousChapter?.id ?? ""}:${nextChapter?.id ?? ""}`;
  const chapterNavigationContextRef = useRef(chapterNavigationContext);
  const historyScroll = useRef<{ chapterId: string; top: number; left: number } | null>(null);
  const previousHistoryOpen = useRef(historyOpen);

  const resizeChapterTitle = useCallback(() => {
    const title = titleRef.current;
    if (!title) return;
    title.style.height = "auto";
    if (title.scrollHeight > 0) {
      const style = getComputedStyle(title);
      const borderHeight =
        (Number.parseFloat(style.borderTopWidth) || 0) +
        (Number.parseFloat(style.borderBottomWidth) || 0);
      title.style.height = `${title.scrollHeight + borderHeight}px`;
    }
  }, []);

  const cancelPendingTitleSelection = useCallback(() => {
    if (pendingTitleSelectionFrameRef.current === null) return;
    window.cancelAnimationFrame(pendingTitleSelectionFrameRef.current);
    pendingTitleSelectionFrameRef.current = null;
  }, []);

  useLayoutEffect(() => {
    if (displayedChapterTitle === undefined) return;
    resizeChapterTitle();
  }, [displayedChapterTitle, resizeChapterTitle]);

  useEffect(() => {
    const composition = titleCompositionRef.current;
    if (composition && composition.chapterId !== currentChapterId) {
      titleCompositionRef.current = null;
      setTitleComposition(null);
    }
    cancelPendingTitleSelection();
  }, [cancelPendingTitleSelection, currentChapterId]);

  useEffect(() => cancelPendingTitleSelection, [cancelPendingTitleSelection]);

  useEffect(() => {
    if (!currentChapterId) return;
    const title = titleRef.current;
    if (!title) return;
    const observed = title.parentElement ?? title;
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(resizeChapterTitle) : null;
    observer?.observe(observed);
    window.addEventListener("resize", resizeChapterTitle);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resizeChapterTitle);
    };
  }, [currentChapterId, resizeChapterTitle]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || previousHistoryOpen.current === historyOpen) return;
    previousHistoryOpen.current = historyOpen;
    const saved = historyScroll.current;
    if (historyOpen && currentChapterId) {
      abandonSessionRestore();
      historyScroll.current = {
        chapterId: currentChapterId,
        top: scroller.scrollTop,
        left: scroller.scrollLeft,
      };
    } else if (!historyOpen && saved && saved.chapterId === currentChapterId) {
      const frame = requestAnimationFrame(() => {
        scroller.scrollTop = saved.top;
        scroller.scrollLeft = saved.left;
        historyScroll.current = null;
        captureSession();
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [abandonSessionRestore, captureSession, currentChapterId, historyOpen]);

  const updateChapterOverscroll = (next: ReturnType<typeof idleChapterOverscroll>) => {
    chapterOverscrollRef.current = next;
    setChapterOverscroll(next);
  };

  const clearChapterOverscrollInactivity = () => {
    if (chapterOverscrollInactivityRef.current === null) return;
    window.clearTimeout(chapterOverscrollInactivityRef.current);
    chapterOverscrollInactivityRef.current = null;
  };

  const resetChapterOverscroll = () => {
    clearChapterOverscrollInactivity();
    if (chapterOverscrollRef.current.direction === null) return;
    updateChapterOverscroll(idleChapterOverscroll());
  };

  const scheduleChapterOverscrollInactivity = () => {
    clearChapterOverscrollInactivity();
    chapterOverscrollInactivityRef.current = window.setTimeout(() => {
      chapterOverscrollInactivityRef.current = null;
      if (chapterOverscrollRef.current.direction !== null) {
        updateChapterOverscroll(idleChapterOverscroll());
      }
    }, CHAPTER_OVERSCROLL_REGRIP_GRACE_MS);
  };

  const targetForDirection = (direction: ChapterOverscrollDirection) =>
    direction === "top" ? previousChapter : nextChapter;

  const navigateChapter = (direction: ChapterOverscrollDirection) => {
    const target = targetForDirection(direction);
    if (!target) return;
    pendingLandingRef.current = {
      chapterId: target.id,
      edge: direction === "top" ? "bottom" : "top",
    };
    // Whatever is still arriving belongs to the gesture that just turned this page.
    chapterWheelStreamRef.current.blocked = true;
    resetChapterOverscroll();
    onNavigateChapter(target.id);
  };

  useLayoutEffect(() => {
    if (historyOpen) return;
    const saved = restoreRef.current;
    if (!saved) {
      captureSession();
      return;
    }
    if (!allowSessionRestore || saved.chapterId !== currentChapterId || pendingLandingRef.current) {
      restoreRef.current = null;
      return;
    }
    const restoreViewport = () => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      editorRef.current?.focus();
      scroller.scrollTop = Math.max(0, saved.scrollTop);
    };
    // Set the viewport before paint, then write the exact position after CodeMirror has
    // measured its virtual document and applied scroll anchoring. This is a one-time return,
    // never a chapter landing rule.
    restoreViewport();
    const finishRestore = (hasFocus: boolean) => {
      pendingRestoreCancelRef.current = null;
      if (restoreRef.current !== saved) return;
      const scroller = scrollRef.current;
      if (!scroller || !hasFocus) {
        restoreRef.current = null;
        return;
      }
      scroller.scrollTop = Math.max(0, saved.scrollTop);
      restoreRef.current = null;
      const view = viewSelectionRef.current;
      if (view) {
        sessionCallbackRef.current?.({ ...view, scrollTop: scroller.scrollTop });
      }
    };
    const afterMeasure = editorRef.current?.afterMeasure;
    let cancel: () => void;
    if (afterMeasure) {
      cancel = afterMeasure(finishRestore);
    } else {
      const frame = requestAnimationFrame(() => finishRestore(Boolean(editorRef.current)));
      cancel = () => cancelAnimationFrame(frame);
    }
    pendingRestoreCancelRef.current = cancel;
    return () => {
      if (pendingRestoreCancelRef.current === cancel) pendingRestoreCancelRef.current = null;
      cancel();
    };
  }, [allowSessionRestore, captureSession, currentChapterId, editorRef, historyOpen]);

  useLayoutEffect(() => {
    const pending = pendingLandingRef.current;
    if (!pending || !currentChapterId) return;
    if (pending.chapterId !== currentChapterId) {
      pendingLandingRef.current = null;
      return;
    }
    const frame = requestAnimationFrame(() => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      scroller.scrollTop =
        pending.edge === "top" ? 0 : Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      pendingLandingRef.current = null;
      editorRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [currentChapterId, editorRef]);

  useEffect(() => {
    if (chapterNavigationContextRef.current === chapterNavigationContext) return;
    chapterNavigationContextRef.current = chapterNavigationContext;
    if (chapterOverscrollInactivityRef.current !== null) {
      window.clearTimeout(chapterOverscrollInactivityRef.current);
      chapterOverscrollInactivityRef.current = null;
    }
    const next = idleChapterOverscroll();
    chapterOverscrollRef.current = next;
    setChapterOverscroll(next);
    const idleTouch = idleChapterTouch();
    chapterTouchRef.current = idleTouch;
    setChapterTouch(idleTouch);
  }, [chapterNavigationContext]);

  useEffect(
    () => () => {
      if (chapterOverscrollInactivityRef.current !== null) {
        window.clearTimeout(chapterOverscrollInactivityRef.current);
      }
    },
    [],
  );

  const onChapterWheel = (event: ReactWheelEvent<HTMLElement>) => {
    abandonSessionRestore();
    if (event.ctrlKey || event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY))
      return;
    const scroller = event.currentTarget;
    const deltaFactor =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientHeight : 1;
    const delta = event.deltaY * deltaFactor;
    const direction: ChapterOverscrollDirection = delta < 0 ? "top" : "bottom";
    const now = performance.now();
    const stream = chapterWheelStreamRef.current;
    const startsNewStream =
      stream.lastInputAt === null ||
      now < stream.lastInputAt ||
      now - stream.lastInputAt > CHAPTER_WHEEL_STREAM_GAP_MS;
    stream.lastInputAt = now;
    if (startsNewStream) stream.blocked = false;

    if (Math.abs(delta) < 2) {
      if (
        chapterOverscrollRef.current.direction !== null &&
        chapterOverscrollRef.current.direction !== direction
      ) {
        resetChapterOverscroll();
      }
      return;
    }
    const atBoundary =
      direction === "top"
        ? scroller.scrollTop <= 1
        : scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1;
    if (!atBoundary) {
      // This stream was spent scrolling the chapter. Its momentum must not turn
      // the page once it coasts into the edge -- that takes a fresh gesture.
      stream.blocked = true;
      resetChapterOverscroll();
      return;
    }
    if (stream.blocked) {
      resetChapterOverscroll();
      return;
    }
    const transition = advanceChapterOverscroll(chapterOverscrollRef.current, {
      direction,
      now,
      hasTarget: Boolean(targetForDirection(direction)),
    });
    updateChapterOverscroll(transition.state);
    if (transition.navigate) {
      navigateChapter(transition.navigate);
    } else if (transition.state.direction !== null) {
      scheduleChapterOverscrollInactivity();
    } else {
      clearChapterOverscrollInactivity();
    }
  };

  const edgesOf = (scroller: HTMLElement) => ({
    atTop: scroller.scrollTop <= 1,
    atBottom: scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1,
  });

  const updateChapterTouch = (next: ChapterTouchState) => {
    chapterTouchRef.current = next;
    setChapterTouch(next);
  };

  const abandonChapterTouch = () => {
    if (chapterTouchRef.current.abandoned && chapterTouchRef.current.direction === null) return;
    updateChapterTouch({
      ...chapterTouchRef.current,
      direction: null,
      progress: 0,
      abandoned: true,
    });
  };

  const onChapterTouchStart = (event: ReactTouchEvent<HTMLElement>) => {
    abandonSessionRestore();
    // Two fingers are a pinch or a zoom, never a page turn.
    if (event.touches.length !== 1) {
      abandonChapterTouch();
      return;
    }
    const touch = event.touches[0];
    updateChapterTouch(
      beginChapterTouch({
        x: touch.clientX,
        y: touch.clientY,
        ...edgesOf(event.currentTarget),
      }),
    );
  };

  const onChapterTouchMove = (event: ReactTouchEvent<HTMLElement>) => {
    if (event.touches.length !== 1) {
      abandonChapterTouch();
      return;
    }
    const touch = event.touches[0];
    updateChapterTouch(
      advanceChapterTouch(
        chapterTouchRef.current,
        { x: touch.clientX, y: touch.clientY, ...edgesOf(event.currentTarget) },
        (direction) => Boolean(targetForDirection(direction)),
      ),
    );
  };

  const onChapterTouchEnd = () => {
    const direction = chapterTouchNavigation(chapterTouchRef.current);
    updateChapterTouch(idleChapterTouch());
    if (direction) navigateChapter(direction);
  };

  const onChapterScroll = () => {
    captureSession();
    const scroller = scrollRef.current;
    const direction = chapterOverscrollRef.current.direction;
    if (!scroller || direction === null) return;
    const stillAtBoundary =
      direction === "top"
        ? scroller.scrollTop <= 1
        : scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1;
    if (!stillAtBoundary) resetChapterOverscroll();
  };

  // One reading for the affordance, whichever kind of input is driving it.
  const chapterTurnDirection = chapterOverscroll.direction ?? chapterTouch.direction;
  const chapterTurnProgress =
    chapterOverscroll.direction !== null ? chapterOverscroll.progress : chapterTouch.progress;

  return (
    <ScrollArea
      ref={scrollRef}
      as="article"
      axis="y"
      gutter="both-edges"
      overscroll="contain"
      scrollbar="thin"
      surface="canvas"
      className="editor-scroll"
      data-chapter-turn={chapterTurnDirection ?? "idle"}
      style={
        {
          "--chapter-turn-progress": chapterTurnProgress,
        } as CSSProperties
      }
      onWheel={onChapterWheel}
      onScroll={onChapterScroll}
      onPointerDownCapture={abandonSessionRestore}
      onKeyDownCapture={abandonSessionRestore}
      onTouchStart={onChapterTouchStart}
      onTouchMove={onChapterTouchMove}
      onTouchEnd={onChapterTouchEnd}
      onTouchCancel={() => updateChapterTouch(idleChapterTouch())}
    >
      {current ? (
        <div className={`editor-page ${historyOpen ? "has-chapter-history" : ""}`}>
          {previousChapter && (
            <ChapterTurnAffordance
              direction="previous"
              target={previousChapter}
              progress={chapterTurnDirection === "top" ? chapterTurnProgress : 0}
              active={chapterTurnDirection === "top"}
              onNavigate={() => navigateChapter("top")}
            />
          )}
          <div className="editor-document">
            <TextArea
              ref={titleRef}
              fieldClassName="chapter-title-field"
              className="chapter-title"
              label={t("chapterTitle")}
              labelHidden
              rows={1}
              value={displayedChapterTitle ?? ""}
              disabled={historyOpen}
              onChange={(event) => {
                cancelPendingTitleSelection();
                const composition = titleCompositionRef.current;
                if (composition && composition.chapterId === currentChapterId) {
                  const nextComposition = {
                    chapterId: composition.chapterId,
                    value: event.currentTarget.value,
                  };
                  titleCompositionRef.current = nextComposition;
                  setTitleComposition(nextComposition);
                  return;
                }
                onUpdateTitle(singleLineTitle(event.currentTarget.value));
              }}
              onCompositionStart={(event) => {
                cancelPendingTitleSelection();
                if (!currentChapterId) return;
                const nextComposition = {
                  chapterId: currentChapterId,
                  value: event.currentTarget.value,
                };
                titleCompositionRef.current = nextComposition;
                setTitleComposition(nextComposition);
              }}
              onCompositionEnd={(event) => {
                cancelPendingTitleSelection();
                const composition = titleCompositionRef.current;
                titleCompositionRef.current = null;
                setTitleComposition(null);
                if (composition?.chapterId === currentChapterId) {
                  onUpdateTitle(singleLineTitle(event.currentTarget.value));
                }
              }}
              onKeyDown={(event) => {
                cancelPendingTitleSelection();
                if (
                  event.key === "Enter" &&
                  titleCompositionRef.current?.chapterId !== currentChapterId &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                }
              }}
              onPointerDown={cancelPendingTitleSelection}
              onPaste={(event) => {
                if (titleCompositionRef.current?.chapterId === currentChapterId) return;
                const pasted = event.clipboardData.getData("text");
                if (!/[\r\n]/.test(pasted)) return;
                event.preventDefault();
                cancelPendingTitleSelection();
                const title = event.currentTarget;
                const start = title.selectionStart;
                const end = title.selectionEnd;
                const inserted = singleLineTitle(pasted);
                const nextTitle = `${title.value.slice(0, start)}${inserted}${title.value.slice(end)}`;
                const nextCaret = start + inserted.length;
                const pasteChapterId = currentChapterId;
                onUpdateTitle(nextTitle);
                pendingTitleSelectionFrameRef.current = window.requestAnimationFrame(() => {
                  pendingTitleSelectionFrameRef.current = null;
                  const updatedTitle = titleRef.current;
                  if (
                    pasteChapterId === currentChapterIdRef.current &&
                    updatedTitle?.value === nextTitle &&
                    document.activeElement === updatedTitle
                  ) {
                    updatedTitle.setSelectionRange(nextCaret, nextCaret);
                  }
                });
              }}
              placeholder={t("chapterTitle")}
            />
            {searchQuery && !historyOpen && (
              <SearchNavigation
                query={searchQuery}
                current={activeSearchMatch ? activeSearchIndex + 1 : 0}
                total={searchMatches.length}
                onPrevious={() => onNavigateSearch(-1)}
                onNext={() => onNavigateSearch(1)}
                onClose={onCloseSearch}
              />
            )}
            <ManuscriptEditor
              key={current.id}
              value={historyOpen && historicalChapter ? historicalChapter.text : current.body}
              mentions={historyOpen ? [] : current.mentions}
              marks={historyOpen && historicalChapter ? historicalChapter.marks : current.marks}
              issues={historyOpen ? [] : grammarIssues}
              searchMatches={historyOpen ? [] : currentSearchMatches}
              initialSelection={
                allowSessionRestore && restoreRef.current?.chapterId === current.id
                  ? restoreRef.current.selection
                  : undefined
              }
              onViewSelectionChange={(selection) => {
                if (historyOpen) return;
                viewSelectionRef.current = { chapterId: current.id, selection };
                captureSession();
              }}
              activeSearchMatch={
                !historyOpen && activeSearchMatch?.chapterId === current.id
                  ? activeSearchMatch
                  : null
              }
              entities={historyOpen ? [] : figures.nodes}
              label={t("chapterText")}
              placeholder={t("startWritingPlaceholder")}
              vocabulary={vocabulary}
              editorRef={editorRef}
              onChange={historyOpen ? () => undefined : onEditorChange}
              held={historyOpen ? null : held}
              readOnly={historyOpen}
              versionDiff={historyOpen && historySnapshotReady ? historyProjection : null}
              versionDiffLabels={{
                added: t("versionAdded"),
                addedLineBreak: t("versionAddedLineBreak"),
                removed: t("versionRemoved"),
                formattingAdded: {
                  bold: `${t("versionFormattingAdded")}: ${t("formatBold")}`,
                  italic: `${t("versionFormattingAdded")}: ${t("formatItalic")}`,
                },
                formattingRemoved: {
                  bold: `${t("versionFormattingRemoved")}: ${t("formatBold")}`,
                  italic: `${t("versionFormattingRemoved")}: ${t("formatItalic")}`,
                },
              }}
              onSelection={(next: EditorTextSelection | null) =>
                onSelection(
                  historyOpen || !next
                    ? null
                    : { ...next, chapterId: current.id, revision: current.body },
                )
              }
              onSelectionMenu={(next) =>
                !historyOpen &&
                onSelectionMenu({ ...next, chapterId: current.id, revision: current.body })
              }
              onIssue={onIssue}
              onOpenEntity={(node: FigureNode) =>
                onOpenEntity?.({
                  workspace: node.type === "ort" ? "places" : "figures",
                  id: node.id,
                })
              }
              describeEntity={(node: FigureNode) =>
                `${kindLabel(node.type, t)}${node.sub ? ` · ${node.sub}` : ""}`
              }
              describeMention={(node: FigureNode) => ({
                kind: kindLabel(node.type, t),
                detail: node.sub ?? "",
                openLabel: t("openEntity", { name: node.name }),
              })}
            />
          </div>
          {historyOpen && (
            <ChapterHistoryPanel
              commits={historyCommits}
              selectedRef={historyRef}
              selected={historicalChapter}
              previous={previousHistoricalChapter}
              projection={historyProjection}
              state={historyState}
              onClose={onCloseHistory}
              onRefChange={onHistoryRef}
            />
          )}
          {nextChapter && (
            <ChapterTurnAffordance
              direction="next"
              target={nextChapter}
              progress={chapterTurnDirection === "bottom" ? chapterTurnProgress : 0}
              active={chapterTurnDirection === "bottom"}
              onNavigate={() => navigateChapter("bottom")}
            />
          )}
        </div>
      ) : (
        <EmptyState
          className="empty-state"
          title={t("noChapterYet")}
          icon={<span className="empty-glyph">Aa</span>}
          actions={
            <Button appearance="primary" onClick={onCreateChapter}>
              {t("createFirstChapter")}
            </Button>
          }
        />
      )}
    </ScrollArea>
  );
}
