import { X } from "lucide-react";
import { useMemo } from "react";
import { IconButton, SidePanelHeader } from "../../design";
import { useI18n } from "../../i18n";
import type { ViewportMode } from "../../shared";
import type { TimelineMoment, TimeSystem } from "../story-world";
import { manuscriptStructure } from "./binder/manuscriptTree";
import type { ChapterActionsMenuProps } from "./ChapterActionsMenu";
import { ChapterTree } from "./ChapterTree";
import type { Chapter, Manuscript, ManuscriptStructure } from "./model";
import "./ChapterBinder.css";

/**
 * The binder answers one question: which chapter. Everything that acts on the selected
 * chapter -- note, story time, placement, export, deletion -- lives in the inspector on
 * the other side, so the left column stays pure structure.
 */
interface ChapterBinderProps {
  manuscript: Manuscript;
  current?: Chapter;
  timeline?: TimelineMoment[];
  timeSystem?: TimeSystem;
  viewportMode: ViewportMode;
  chapterActions?: ChapterActionsMenuProps;
  onClose: () => void;
  onSelect: (id: string) => void;
  onStructureChange: (structure: ManuscriptStructure) => void;
}

export function ChapterBinder({
  manuscript,
  current,
  timeline,
  timeSystem,
  viewportMode,
  chapterActions,
  onClose,
  onSelect,
  onStructureChange,
}: ChapterBinderProps) {
  const { t } = useI18n();
  const structure = useMemo(() => manuscriptStructure(manuscript), [manuscript]);
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
        chapterActions={chapterActions}
      />
    </>
  );
}
