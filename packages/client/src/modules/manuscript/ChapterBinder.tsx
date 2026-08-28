import { X } from "lucide-react";
import { useMemo } from "react";
import { IconButton, SidePanelHeader } from "../../design";
import { useI18n } from "../../i18n";
import type { ViewportMode } from "../../shared";
import type { TimelineMoment, TimeSystem } from "../story-world";
import { NoteEditor, noteFocusCopy } from "../notes";
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
  const currentSiblings = currentItem ? childrenOf(structure, currentItem.parentFolderId) : [];
  const currentIndex = currentItem
    ? currentSiblings.findIndex((item) => item.id === currentItem.id)
    : -1;

  const moveCurrent = (delta: number) => {
    if (!currentItem) return;
    const siblings = currentSiblings;
    const index = currentIndex;
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
        chapterActions={
          current
            ? {
                title: current.title || t("untitled"),
                canMoveUp: currentIndex > 0,
                canMoveDown: currentIndex >= 0 && currentIndex < currentSiblings.length - 1,
                onMoveUp: () => moveCurrent(-1),
                onMoveDown: () => moveCurrent(1),
                onExport: onExportCurrent,
                onDelete: onRequestDelete,
              }
            : undefined
        }
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
          <NoteEditor
            owner={{ kind: "chapter", id: current.id }}
            fieldClassName="binder-note"
            className="binder-note-control"
            label={t("chapterNote")}
            value={current.note}
            references={current.noteReferences}
            onChange={(note, noteReferences) => onUpdateCurrent({ note, noteReferences })}
            placeholder={t("chapterNotePlaceholder")}
            size="compact"
            focus={noteFocusCopy(t, current.title || t("untitled"))}
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
