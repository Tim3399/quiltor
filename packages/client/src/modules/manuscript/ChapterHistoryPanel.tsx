import { X } from "lucide-react";
import {
  Alert,
  EmptyState,
  IconButton,
  ProgressBar,
  Select,
  SidePanel,
  SidePanelHeader,
} from "../../design";
import { useI18n } from "../../i18n";
import type { SnapshotInfo } from "../history";
import type { ChapterHistoryState } from "./useChapterHistory";

export interface ChapterHistoryPanelProps {
  commits: SnapshotInfo[];
  selectedRef: string;
  historicalText: string;
  state: ChapterHistoryState;
  onClose: () => void;
  onRefChange: (value: string) => void;
}

export function ChapterHistoryPanel({
  commits,
  selectedRef,
  historicalText,
  state,
  onClose,
  onRefChange,
}: ChapterHistoryPanelProps) {
  const { t } = useI18n();

  return (
    <SidePanel className="chapter-history" label={t("versions")}>
      <SidePanelHeader
        className="chapter-history__header"
        title={
          <span className="chapter-history__title">
            <span>{t("previousVersion")}</span>
            <small>{t("nextToCurrent")}</small>
          </span>
        }
        actions={<IconButton label={t("closeVersions")} icon={<X />} onClick={onClose} />}
      />
      {commits.length ? (
        <Select
          fieldClassName="chapter-history-state"
          label={t("state")}
          value={selectedRef}
          onChange={(event) => onRefChange(event.target.value)}
        >
          {commits.map((commit) => (
            <option key={commit.hash} value={commit.hash}>
              {commit.date} · {commit.subject}
            </option>
          ))}
        </Select>
      ) : (
        state !== "loading" && <EmptyState title={t("noVersion")} headingLevel={3} size="compact" />
      )}
      {state === "loading" ? (
        <ProgressBar label={t("loadingVersion")} />
      ) : state === "error" ? (
        <Alert tone="danger">{t("versionLoadError")}</Alert>
      ) : (
        commits.length > 0 && (
          <div className="historical-prose">
            {historicalText || <em>{t("chapterNotYetExisting")}</em>}
          </div>
        )
      )}
    </SidePanel>
  );
}
