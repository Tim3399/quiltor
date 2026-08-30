import { X } from "lucide-react";
import { useMemo } from "react";
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
import { diffVersionText, type SnapshotInfo } from "../history";
import type { ChapterHistoryState } from "./useChapterHistory";
import "./ChapterHistoryPanel.css";

export interface ChapterHistoryPanelProps {
  commits: SnapshotInfo[];
  selectedRef: string;
  historicalText: string;
  historicalExists: boolean;
  previousHistoricalText: string;
  comparisonAvailable: boolean;
  state: ChapterHistoryState;
  onClose: () => void;
  onRefChange: (value: string) => void;
}

export function ChapterHistoryPanel({
  commits,
  selectedRef,
  historicalText,
  historicalExists,
  previousHistoricalText,
  comparisonAvailable,
  state,
  onClose,
  onRefChange,
}: ChapterHistoryPanelProps) {
  const { t } = useI18n();
  const diff = useMemo(() => {
    const occurrences = new Map<string, number>();
    return diffVersionText(previousHistoricalText, historicalText).map((segment) => {
      const contentKey = `${segment.kind}\u0000${segment.text}`;
      const occurrence = (occurrences.get(contentKey) ?? 0) + 1;
      occurrences.set(contentKey, occurrence);
      return { ...segment, key: `${contentKey}\u0000${occurrence}` };
    });
  }, [historicalText, previousHistoricalText]);
  const hasChanges = comparisonAvailable && diff.some((segment) => segment.kind !== "unchanged");

  return (
    <SidePanel className="chapter-history" label={t("versions")}>
      <SidePanelHeader
        className="chapter-history__header"
        title={
          <span className="chapter-history__title">
            <span>{t("previousVersion")}</span>
            <small>{t("changesSincePreviousVersion")}</small>
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
        state === "idle" && <EmptyState title={t("noVersion")} headingLevel={3} size="compact" />
      )}
      {state === "loading" ? (
        <ProgressBar label={t("loadingVersion")} />
      ) : state === "error" ? (
        <Alert tone="danger">{t("versionLoadError")}</Alert>
      ) : (
        commits.length > 0 && (
          <>
            {!comparisonAvailable && (
              <p className="chapter-version-diff__status" role="status">
                {t("versionComparisonUnavailable")}
              </p>
            )}
            {hasChanges ? (
              <section className="chapter-version-diff__legend" aria-label={t("versionDiffLegend")}>
                <span className="chapter-version-diff__legend-add">
                  <span aria-hidden="true">+</span>
                  {t("versionAdded")}
                </span>
                <span className="chapter-version-diff__legend-remove">
                  <span aria-hidden="true">−</span>
                  {t("versionRemoved")}
                </span>
              </section>
            ) : (
              comparisonAvailable &&
              historicalExists &&
              historicalText && (
                <p className="chapter-version-diff__status" role="status">
                  {t("noChanges")}
                </p>
              )
            )}
            {!historicalExists && (
              <p className="chapter-version-diff__status" role="status">
                {t("chapterNotYetExisting")}
              </p>
            )}
            {historicalExists && !historicalText && !hasChanges && (
              <div className="historical-prose">
                <em>{t("emptyChapterVersion")}</em>
              </div>
            )}
            {comparisonAvailable && (historicalText || previousHistoricalText) ? (
              <section
                className="historical-prose chapter-version-diff"
                aria-label={t("versionDiff")}
              >
                {diff.map((segment) =>
                  segment.kind === "added" ? (
                    <ins key={segment.key}>
                      <span className="sr-only">{t("versionAdded")}: </span>
                      {segment.text}
                    </ins>
                  ) : segment.kind === "removed" ? (
                    <del key={segment.key}>
                      <span className="sr-only">{t("versionRemoved")}: </span>
                      {segment.text}
                    </del>
                  ) : (
                    <span key={segment.key}>{segment.text}</span>
                  ),
                )}
              </section>
            ) : (
              historicalExists &&
              historicalText && <div className="historical-prose">{historicalText}</div>
            )}
          </>
        )
      )}
    </SidePanel>
  );
}
