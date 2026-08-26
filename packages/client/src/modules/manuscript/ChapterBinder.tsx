import { ChevronDown, ChevronUp, Download, Trash2, X } from "lucide-react";
import { useMemo } from "react";
import {
  IconButton,
  SidePanelHeader,
  TextArea,
  WorkspaceToolbar,
  WorkspaceToolbarGroup,
} from "../../design";
import { useI18n } from "../../i18n";
import type { ViewportMode } from "../../shared";
import type { TimelineMoment, TimeSystem } from "../story-world";
import {
  childrenOf,
  flattenChapterIds,
  manuscriptStructure,
  moveTreeItem,
} from "./binder/manuscriptTree";
import { ChapterStoryTimeFields } from "./ChapterStoryTimeFields";
import { ChapterTree } from "./ChapterTree";
import type { Chapter, Manuscript, ManuscriptStructure } from "./model";
import "./ChapterBinder.css";

interface ChapterBinderProps {
  manuscript: Manuscript;
  current?: Chapter;
  timeline?: TimelineMoment[];
  timeSystem?: TimeSystem;
  totalWords: number;
  viewportMode: ViewportMode;
  onClose: () => void;
  onSelect: (id: string) => void;
  onStructureChange: (structure: ManuscriptStructure) => void;
  onUpdateCurrent: (patch: Partial<Chapter>) => void;
  onExportCurrent: () => void;
  onRequestDelete: () => void;
}

export function ChapterBinder({
  manuscript,
  current,
  timeline,
  timeSystem,
  totalWords,
  viewportMode,
  onClose,
  onSelect,
  onStructureChange,
  onUpdateCurrent,
  onExportCurrent,
  onRequestDelete,
}: ChapterBinderProps) {
  const { t } = useI18n();
  const structure = useMemo(() => manuscriptStructure(manuscript), [manuscript]);
  const orderedIds = useMemo(() => flattenChapterIds(structure), [structure]);
  const currentItem = current
    ? structure.items.find((item) => item.kind === "chapter" && item.chapterId === current.id)
    : undefined;

  const moveCurrent = (delta: number) => {
    if (!currentItem) return;
    const siblings = childrenOf(structure, currentItem.parentFolderId);
    const index = siblings.findIndex((item) => item.id === currentItem.id);
    const beforeItemId =
      delta < 0
        ? siblings[index - 1]?.id
        : index >= 0 && index < siblings.length - 1
          ? siblings[index + 2]?.id
          : undefined;
    if ((delta < 0 && index <= 0) || (delta > 0 && index >= siblings.length - 1)) return;
    onStructureChange(
      moveTreeItem(structure, currentItem.id, currentItem.parentFolderId, beforeItemId),
    );
  };

  return (
    <>
      <SidePanelHeader
        className="chapter-binder__header"
        title={t("chapters")}
        actions={
          <IconButton
            icon={<X />}
            label={t("closeNavigation")}
            onClick={onClose}
            title={t("closeNavigation")}
          />
        }
      />
      {current && (
        <section className="binder-chapter-actions">
          <span>{t("chapterActions")}</span>
          <WorkspaceToolbar
            className="binder-chapter-toolbar"
            label={`${t("chapterActions")}: ${current.title || t("untitled")}`}
          >
            <WorkspaceToolbarGroup
              className="binder-chapter-toolbar-group"
              label={`${t("chapterActions")}: ${current.title || t("untitled")}`}
            >
              <IconButton
                className="binder-chapter-action"
                icon={<ChevronUp />}
                label={t("moveUp")}
                size="compact"
                disabled={!currentItem || currentItem.position <= 0}
                onClick={() => moveCurrent(-1)}
                title={t("moveUp")}
              />
              <IconButton
                className="binder-chapter-action"
                icon={<ChevronDown />}
                label={t("moveDown")}
                size="compact"
                disabled={
                  !currentItem ||
                  currentItem.position >=
                    childrenOf(structure, currentItem.parentFolderId).length - 1
                }
                onClick={() => moveCurrent(1)}
                title={t("moveDown")}
              />
              <IconButton
                className="binder-chapter-action"
                icon={<Download />}
                label={t("chapterMarkdown")}
                size="compact"
                onClick={onExportCurrent}
                title={t("chapterMarkdown")}
              />
              <IconButton
                className="binder-chapter-action chapter-action-delete"
                icon={<Trash2 />}
                label={t("deleteChapter")}
                size="compact"
                tone="danger"
                onClick={onRequestDelete}
                title={t("deleteChapter")}
              />
            </WorkspaceToolbarGroup>
          </WorkspaceToolbar>
        </section>
      )}
      <ChapterTree
        manuscript={manuscript}
        structure={structure}
        current={current}
        timeline={timeline}
        timeSystem={timeSystem}
        viewportMode={viewportMode}
        onClose={onClose}
        onSelect={onSelect}
        onStructureChange={onStructureChange}
      />
      {current && (
        <>
          <ChapterStoryTimeFields
            key={current.id}
            chapter={current}
            timeline={timeline}
            timeSystem={timeSystem}
            onChange={(storyTime) => onUpdateCurrent({ storyTime })}
          />
          <TextArea
            fieldClassName="binder-note"
            className="binder-note-control"
            label={t("chapterNote")}
            value={current.note}
            onChange={(event) => onUpdateCurrent({ note: event.target.value })}
            placeholder={t("chapterNotePlaceholder")}
          />
        </>
      )}
      <footer className="chapter-binder__footer">
        {orderedIds.length} {t("chapters")} · {(totalWords / 250).toFixed(1).replace(".", ",")}{" "}
        {t("standardPages")}
      </footer>
    </>
  );
}
