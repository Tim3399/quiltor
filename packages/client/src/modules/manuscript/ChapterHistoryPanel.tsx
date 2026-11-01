import { X } from "lucide-react";
import {
  Alert,
  EmptyState,
  IconButton,
  ProgressBar,
  Select,
  SidePanel,
  SidePanelBody,
  SidePanelHeader,
} from "../../design";
import { useI18n } from "../../i18n";
import type { SnapshotChapterRecord } from "../../platform";
import { type SnapshotInfo, snapshotName, type VersionDiffProjection } from "../history";
import type { ChapterHistoryState } from "./useChapterHistory";
import "./ChapterHistoryPanel.css";

export interface ChapterHistoryPanelProps {
  commits: SnapshotInfo[];
  selectedRef: string;
  selected: SnapshotChapterRecord | null;
  previous: SnapshotChapterRecord | null;
  projection: VersionDiffProjection | null;
  state: ChapterHistoryState;
  onClose: () => void;
  onRefChange: (value: string) => void;
}

export function ChapterHistoryPanel({
  commits,
  selectedRef,
  selected,
  previous,
  projection,
  state,
  onClose,
  onRefChange,
}: ChapterHistoryPanelProps) {
  const { t, locale } = useI18n();
  const chosen = commits.find((commit) => commit.hash === selectedRef);
  const chosenName = chosen ? snapshotName(chosen, t, locale) : undefined;
  const additions = projection?.changes.filter((change) => change.kind === "added").length ?? 0;
  const removals = projection?.changes.filter((change) => change.kind === "removed").length ?? 0;
  const formattingAdded =
    projection?.formattingChanges.filter((change) => change.kind === "format-added").length ?? 0;
  const formattingRemoved =
    projection?.formattingChanges.filter((change) => change.kind === "format-removed").length ?? 0;
  const hasChanges = additions + removals + formattingAdded + formattingRemoved > 0;

  return (
    <SidePanel className="chapter-history" label={t("versions")} width="fill">
      <SidePanelHeader
        title={t("previousVersion")}
        actions={
          <IconButton
            label={t("closeVersions")}
            icon={<X />}
            onClick={onClose}
            title={t("closeVersions")}
          />
        }
      />
      <SidePanelBody className="chapter-history__body">
        {commits.length ? (
          <Select
            fieldClassName="chapter-history-state"
            label={t("state")}
            value={selectedRef}
            title={chosenName}
            description={chosenName}
            hint={t("changesSincePreviousVersion")}
            onChange={(event) => onRefChange(event.target.value)}
          >
            {commits.map((commit) => (
              <option key={commit.hash} value={commit.hash}>
                {snapshotName(commit, t, locale)}
              </option>
            ))}
          </Select>
        ) : (
          state === "idle" && <EmptyState title={t("noVersion")} headingLevel={3} size="compact" />
        )}
        {state === "loading" ? (
          <ProgressBar label={t("loadingVersion")} />
        ) : state === "error" ? (
          <Alert tone="danger">{t("versionLoadError")}</Alert>
        ) : (
          selected && (
            <>
              {!previous?.available && (
                <p className="chapter-version-diff__status" role="status">
                  {t("versionComparisonUnavailable")}
                </p>
              )}
              {previous?.available && hasChanges && (
                <section
                  className="chapter-version-diff__legend"
                  aria-label={t("versionDiffLegend")}
                >
                  {additions > 0 && (
                    <span className="chapter-version-diff__legend-add">+ {t("versionAdded")}</span>
                  )}
                  {removals > 0 && (
                    <span className="chapter-version-diff__legend-remove">
                      − {t("versionRemoved")}
                    </span>
                  )}
                  {formattingAdded > 0 && (
                    <span className="chapter-version-diff__legend-format-add">
                      + {t("versionFormattingAdded")}
                    </span>
                  )}
                  {formattingRemoved > 0 && (
                    <span className="chapter-version-diff__legend-format-remove">
                      − {t("versionFormattingRemoved")}
                    </span>
                  )}
                </section>
              )}
              {previous?.available && !hasChanges && selected.exists && (
                <EmptyState role="status" title={t("noChanges")} headingLevel={3} size="compact" />
              )}
              {!selected.exists && (
                <p className="chapter-version-diff__status" role="status">
                  {t("chapterNotYetExisting")}
                </p>
              )}
              {selected.exists && !selected.text && (
                <p className="chapter-version-diff__status" role="status">
                  {t("emptyChapterVersion")}
                </p>
              )}
            </>
          )
        )}
      </SidePanelBody>
    </SidePanel>
  );
}
