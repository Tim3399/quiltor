import {
  type CSSProperties,
  type MutableRefObject,
  type TouchEvent as ReactTouchEvent,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button, EmptyState, ScrollArea, TextField } from "../../design";
import { useI18n } from "../../i18n";
import type { Workspace } from "../../shared";
import type { SnapshotInfo } from "../history";
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
  chapterTouchNavigation,
  type ChapterTouchState,
  idleChapterTouch,
} from "./chapterTouchTurn";
import {
  type EditorTextSelection,
  ManuscriptEditor,
  type ManuscriptEditorHandle,
} from "./ManuscriptEditor";
import type { Chapter, EntityMention, TextMark, WritingIssue } from "./model";
import { SearchNavigation } from "./SearchNavigation";
import type { ManuscriptSearchMatch } from "./search";
import type { ChapterHistoryState } from "./useChapterHistory";
import type { WorkspaceSelection } from "./workspaceTypes";
import "./EditorSurface.css";

interface EditorSurfaceProps {
  current?: Chapter;
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
  historicalText: string;
  historicalExists: boolean;
  previousHistoricalText: string;
  historyComparisonAvailable: boolean;
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

export function EditorSurface({
  current,
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
  historicalText,
  historicalExists,
  previousHistoricalText,
  historyComparisonAvailable,
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
  const chapterTouchRef = useRef(chapterTouch);
  const chapterOverscrollRef = useRef(chapterOverscroll);
  const currentChapterId = current?.id;
  const chapterNavigationContext = `${currentChapterId ?? ""}:${previousChapter?.id ?? ""}:${nextChapter?.id ?? ""}`;
  const chapterNavigationContextRef = useRef(chapterNavigationContext);

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
      surface="paper"
      className="editor-scroll"
      data-chapter-turn={chapterTurnDirection ?? "idle"}
      style={
        {
          "--chapter-turn-progress": chapterTurnProgress,
        } as CSSProperties
      }
      onWheel={onChapterWheel}
      onScroll={onChapterScroll}
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
            <TextField
              fieldClassName="chapter-title-field"
              className="chapter-title"
              label={t("chapterTitle")}
              labelHidden
              value={current.title}
              onChange={(event) => onUpdateTitle(event.target.value)}
              placeholder={t("chapterTitle")}
            />
            {searchQuery && (
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
              value={current.body}
              mentions={current.mentions}
              marks={current.marks}
              issues={grammarIssues}
              searchMatches={currentSearchMatches}
              activeSearchMatch={
                activeSearchMatch?.chapterId === current.id ? activeSearchMatch : null
              }
              entities={figures.nodes}
              label={t("chapterText")}
              placeholder={t("startWritingPlaceholder")}
              vocabulary={vocabulary}
              editorRef={editorRef}
              onChange={onEditorChange}
              held={held}
              onSelection={(next: EditorTextSelection | null) =>
                onSelection(
                  next ? { ...next, chapterId: current.id, revision: current.body } : null,
                )
              }
              onSelectionMenu={(next) =>
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
            />
          </div>
          {historyOpen && (
            <ChapterHistoryPanel
              commits={historyCommits}
              selectedRef={historyRef}
              historicalText={historicalText}
              historicalExists={historicalExists}
              previousHistoricalText={previousHistoricalText}
              comparisonAvailable={historyComparisonAvailable}
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
