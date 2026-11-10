import { X } from "lucide-react";
import { useState } from "react";
import {
  Alert,
  Button,
  EmptyState,
  IconButton,
  ProgressBar,
  SegmentedControl,
  Select,
  SelectionCard,
  SidePanel,
  SidePanelBody,
  SidePanelHeader,
} from "../../design";
import { useI18n } from "../../i18n";
import type { ChapterTimelineEntry, SnapshotChapterRecord } from "../../platform";
import { type SnapshotInfo, snapshotName, type VersionDiffProjection } from "../history";
import type { ChapterHistoryState } from "./useChapterHistory";
import { useChapterTimeline } from "./useChapterTimeline";
import "./ChapterHistoryPanel.css";

type HistoryView = "single" | "timeline";

const CHANGE_LABELS = {
  created: "chapterTimelineCreated",
  edited: "chapterTimelineEdited",
  deleted: "chapterTimelineDeleted",
  unknown: "chapterTimelineUnknown",
} as const satisfies Record<ChapterTimelineEntry["change"], string>;

function wordCount(text: string): number {
  return text.split(/\s+/u).filter(Boolean).length;
}

export interface ChapterHistoryPanelProps {
  /** The chapter whose versions the timeline lists. */
  chapterId?: string;
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
  chapterId,
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
  const [view, setView] = useState<HistoryView>("single");
  const timeline = useChapterTimeline(chapterId, view === "timeline", {
    selectedRef,
    setSelectedRef: onRefChange,
  });
  const chosen =
    commits.find((commit) => commit.hash === selectedRef) ??
    timeline.entries.find((entry) => entry.hash === selectedRef);
  const chosenName = chosen ? snapshotName(chosen, t, locale) : undefined;
  const additions = projection?.changes.filter((change) => change.kind === "added").length ?? 0;
  const removals = projection?.changes.filter((change) => change.kind === "removed").length ?? 0;
  const formattingAdded =
    projection?.formattingChanges.filter((change) => change.kind === "format-added").length ?? 0;
  const formattingRemoved =
    projection?.formattingChanges.filter((change) => change.kind === "format-removed").length ?? 0;
  const hasChanges = additions + removals + formattingAdded + formattingRemoved > 0;
  const addedWords =
    projection?.changes.reduce(
      (sum, change) => (change.kind === "added" ? sum + wordCount(change.text) : sum),
      0,
    ) ?? 0;
  const removedWords =
    projection?.changes.reduce(
      (sum, change) => (change.kind === "removed" ? sum + wordCount(change.text) : sum),
      0,
    ) ?? 0;

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
        <SegmentedControl
          className="chapter-history__view"
          label={t("versionView")}
          value={view}
          onChange={setView}
          size="compact"
          options={[
            { value: "single", label: t("versionViewSingle") },
            { value: "timeline", label: t("versionViewTimeline") },
          ]}
        />
        {view === "timeline" ? (
          <section className="chapter-timeline" aria-label={t("chapterTimelineLabel")}>
            {timeline.entries.length > 0 && (
              <ul className="chapter-timeline__list">
                {timeline.entries.map((entry) => {
                  const open = entry.hash === selectedRef;
                  const name = snapshotName(entry, t, locale);
                  return (
                    <li key={entry.hash}>
                      <SelectionCard
                        className="chapter-timeline__entry"
                        label={`${name}, ${t(CHANGE_LABELS[entry.change])}`}
                        title={t(CHANGE_LABELS[entry.change])}
                        description={name}
                        descriptionLayout="wrap"
                        selected={open}
                        aria-expanded={open}
                        onSelect={() => timeline.select(entry.hash)}
                      />
                      {open && entry.change === "edited" && projection && previous?.available && (
                        <p className="chapter-timeline__words">
                          {t("chapterTimelineWords", { added: addedWords, removed: removedWords })}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {timeline.skipped > 0 && (
              <p className="chapter-timeline__skipped">
                {timeline.skipped === 1
                  ? t("chapterTimelineSkippedOne")
                  : t("chapterTimelineSkippedMany", { n: timeline.skipped })}
              </p>
            )}
            {timeline.state === "error" ? (
              <Alert
                tone="danger"
                action={
                  <Button size="compact" onClick={timeline.retry}>
                    {t("chapterTimelineRetry")}
                  </Button>
                }
              >
                {t("chapterTimelineLoadError")}
              </Alert>
            ) : timeline.state === "loading" ? (
              <ProgressBar label={t("loadingVersion")} />
            ) : (
              <>
                {!timeline.entries.length && (
                  <EmptyState title={t("chapterTimelineEmpty")} headingLevel={3} size="compact" />
                )}
                {timeline.hasMore && (
                  <Button size="compact" onClick={timeline.loadMore}>
                    {t("chapterTimelineLoadMore")}
                  </Button>
                )}
              </>
            )}
          </section>
        ) : commits.length ? (
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
