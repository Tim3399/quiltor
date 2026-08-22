import type { MutableRefObject } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useI18n } from "../../i18n";
import type { Workspace } from "../../shared";
import type { SnapshotInfo } from "../history";
import { kindLabel, type FigureNode, type FigureState } from "../story-world";
import {
  ManuscriptEditor,
  type EditorTextSelection,
  type ManuscriptEditorHandle,
} from "./ManuscriptEditor";
import type { Chapter, EntityMention, TextMark, WritingIssue } from "./model";
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
    <article className="editor-scroll">
      {current ? (
        <div className={`editor-page ${historyOpen ? "has-chapter-history" : ""}`}>
          <div className="editor-document">
            <input
              className="chapter-title"
              aria-label={t("chapterTitle")}
              value={current.title}
              onChange={(event) => onUpdateTitle(event.target.value)}
              placeholder={t("chapterTitle")}
            />
            {searchQuery && (
              <div
                className="text-search-navigation"
                role="search"
                aria-label={t("textSearchResults")}
              >
                <Search aria-hidden="true" />
                <strong title={searchQuery}>{searchQuery}</strong>
                <span role="status" aria-live="polite">
                  {t("searchResultPosition", {
                    current: activeSearchMatch ? activeSearchIndex + 1 : 0,
                    total: searchMatches.length,
                  })}
                </span>
                <button
                  className="icon-button"
                  disabled={!searchMatches.length}
                  onClick={() => onNavigateSearch(-1)}
                  aria-label={t("previousSearchResult")}
                  title={t("previousSearchResult")}
                >
                  <ChevronLeft />
                </button>
                <button
                  className="icon-button"
                  disabled={!searchMatches.length}
                  onClick={() => onNavigateSearch(1)}
                  aria-label={t("nextSearchResult")}
                  title={t("nextSearchResult")}
                >
                  <ChevronRight />
                </button>
                <button
                  className="icon-button"
                  onClick={onCloseSearch}
                  aria-label={t("closeTextSearch")}
                  title={t("closeTextSearch")}
                >
                  <X />
                </button>
              </div>
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
            <aside className="chapter-history" aria-label={t("versions")}>
              <header>
                <div>
                  <strong>{t("previousVersion")}</strong>
                  <span>{t("nextToCurrent")}</span>
                </div>
                <button
                  className="icon-button"
                  onClick={onCloseHistory}
                  aria-label={t("closeVersions")}
                >
                  <X />
                </button>
              </header>
              {historyCommits.length ? (
                <label className="field">
                  <span>{t("state")}</span>
                  <select value={historyRef} onChange={(event) => onHistoryRef(event.target.value)}>
                    {historyCommits.map((commit) => (
                      <option key={commit.hash} value={commit.hash}>
                        {commit.date} · {commit.subject}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                historyState !== "loading" && <p className="muted">{t("noVersion")}</p>
              )}
              {historyState === "loading" ? (
                <p className="muted">{t("loadingVersion")}</p>
              ) : historyState === "error" ? (
                <div className="error-box">{t("versionLoadError")}</div>
              ) : (
                historyCommits.length > 0 && (
                  <div className="historical-prose">
                    {historicalText || <em>{t("chapterNotYetExisting")}</em>}
                  </div>
                )
              )}
            </aside>
          )}
        </div>
      ) : (
        <div className="empty-state">
          <span className="empty-glyph" aria-hidden="true">
            Aa
          </span>
          <h2>{t("noChapterYet")}</h2>
          <button className="primary" onClick={onCreateChapter}>
            {t("createFirstChapter")}
          </button>
        </div>
      )}
    </article>
  );
}
