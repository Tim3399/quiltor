import type { MutableRefObject } from "react";
import { Button, EmptyState, ScrollArea, TextField } from "../../design";
import { useI18n } from "../../i18n";
import type { Workspace } from "../../shared";
import type { SnapshotInfo } from "../history";
import { type FigureNode, type FigureState, kindLabel } from "../story-world";
import { ChapterHistoryPanel } from "./ChapterHistoryPanel";
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
  historyState: ChapterHistoryState;
  onCreateChapter: () => void;
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
  historyState,
  onCreateChapter,
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

  return (
    <ScrollArea
      as="article"
      axis="y"
      gutter="both-edges"
      overscroll="auto"
      scrollbar="thin"
      surface="paper"
      className="editor-scroll"
    >
      {current ? (
        <div className={`editor-page ${historyOpen ? "has-chapter-history" : ""}`}>
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
              state={historyState}
              onClose={onCloseHistory}
              onRefChange={onHistoryRef}
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
