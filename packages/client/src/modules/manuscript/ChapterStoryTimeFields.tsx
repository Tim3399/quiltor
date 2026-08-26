import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { ListboxSelect, SegmentedControl } from "../../design";
import { type Translate, useI18n } from "../../i18n";
import {
  canonicalTimelineOrder,
  momentBoundaryTimeLabel,
  momentTimeLabel,
  normalizeTimeSystem,
  type TimelineMoment,
  type TimeSystem,
} from "../story-world";
import type { Chapter, ChapterStoryTime } from "./model";

type StoryTimeMode = "open" | "point" | "range";

function storyTimeMode(storyTime: ChapterStoryTime | undefined): StoryTimeMode {
  if (!storyTime?.startMomentId) return "open";
  return storyTime.endMomentId ? "range" : "point";
}

function momentLabel(
  moment: TimelineMoment,
  timeline: TimelineMoment[],
  system: TimeSystem,
  t: Translate,
): string {
  const title = moment.title || t("untitled");
  return `${title} · ${momentTimeLabel(system, moment, timeline.indexOf(moment), t)}`;
}

function momentBoundaryLabel(
  moment: TimelineMoment,
  timeline: TimelineMoment[],
  system: TimeSystem,
  boundary: "start" | "end",
  t: Translate,
): string {
  const title = moment.title || t("untitled");
  return `${title} · ${momentBoundaryTimeLabel(
    system,
    moment,
    timeline.indexOf(moment),
    boundary,
    t,
  )}`;
}

export function chapterStoryTimeLabel(
  chapter: Chapter,
  timelineValue: TimelineMoment[] | undefined,
  systemValue: TimeSystem | undefined,
  t: Translate,
): string {
  if (!chapter.storyTime?.startMomentId) return t("chapterStoryTimeOpen");
  const timeline = canonicalTimelineOrder(timelineValue || []);
  const system = normalizeTimeSystem(systemValue);
  const start = timeline.find((moment) => moment.id === chapter.storyTime?.startMomentId);
  if (!start) return t("chapterStoryTimeMissing");
  const startLabel = momentBoundaryLabel(start, timeline, system, "start", t);
  if (!chapter.storyTime.endMomentId) return startLabel;
  const end = timeline.find((moment) => moment.id === chapter.storyTime?.endMomentId);
  if (!end) return t("chapterStoryTimeMissing");
  return `${startLabel} – ${momentBoundaryLabel(end, timeline, system, "end", t)}`;
}

export function ChapterStoryTimeFields({
  chapter,
  timeline: timelineValue,
  timeSystem,
  onChange,
}: {
  chapter: Chapter;
  timeline?: TimelineMoment[];
  timeSystem?: TimeSystem;
  onChange: (storyTime: ChapterStoryTime | undefined) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const timeline = canonicalTimelineOrder(timelineValue || []);
  const system = normalizeTimeSystem(timeSystem);
  const momentsById = new Map(timeline.map((moment) => [moment.id, moment]));
  const positions = new Map(timeline.map((moment, index) => [moment.id, index]));
  const storyTime = chapter.storyTime;
  const mode = storyTimeMode(storyTime);
  const firstMomentId = timeline[0]?.id;
  const startMomentId = storyTime?.startMomentId || firstMomentId || "";
  const endMomentId = storyTime?.endMomentId || startMomentId;
  const startPosition = positions.get(startMomentId);
  const endPosition = positions.get(endMomentId);
  const missingStart = Boolean(
    storyTime?.startMomentId && !momentsById.has(storyTime.startMomentId),
  );
  const missingEnd = Boolean(storyTime?.endMomentId && !momentsById.has(storyTime.endMomentId));
  const invalidRange =
    mode === "range" &&
    startPosition !== undefined &&
    endPosition !== undefined &&
    endPosition <= startPosition;
  const options = timeline.map((moment) => ({
    value: moment.id,
    label: momentLabel(moment, timeline, system, t),
  }));
  const startOptions = [
    ...options.map((option) => ({
      ...option,
      disabled: mode === "range" && positions.get(option.value) === timeline.length - 1,
    })),
    ...(missingStart
      ? [
          {
            value: storyTime?.startMomentId || "",
            label: t("chapterStoryTimeMissing"),
            disabled: true,
          },
        ]
      : []),
  ];
  const endOptions = [
    ...options.map((option) => ({
      ...option,
      disabled:
        startPosition !== undefined &&
        (positions.get(option.value) ?? Number.MAX_SAFE_INTEGER) <= startPosition,
    })),
    ...(missingEnd
      ? [
          {
            value: storyTime?.endMomentId || "",
            label: t("chapterStoryTimeMissing"),
            disabled: true,
          },
        ]
      : []),
  ];

  const setMode = (nextMode: StoryTimeMode) => {
    if (nextMode === "open") {
      onChange(undefined);
      return;
    }
    const nextStart = momentsById.has(startMomentId) ? startMomentId : firstMomentId;
    if (!nextStart) return;
    if (nextMode === "point") {
      onChange({ startMomentId: nextStart });
      return;
    }
    const requestedStartPosition = positions.get(nextStart) ?? 0;
    const nextStartPosition = Math.min(requestedStartPosition, timeline.length - 2);
    const rangeStart = timeline[nextStartPosition]?.id;
    if (!rangeStart) return;
    const nextEnd =
      momentsById.has(endMomentId) && (positions.get(endMomentId) ?? -1) > nextStartPosition
        ? endMomentId
        : timeline[nextStartPosition + 1]?.id;
    if (nextEnd) onChange({ startMomentId: rangeStart, endMomentId: nextEnd });
  };

  return (
    <details className="binder-story-time" open={expanded}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: HTML summary is natively interactive, but Biome currently models it as static. */}
      <summary
        onClick={(event) => {
          event.preventDefault();
          setExpanded((value) => !value);
        }}
      >
        <span className="binder-story-time-title">{t("chapterStoryTime")}</span>
        <span
          className={`binder-story-time-value ${
            missingStart || missingEnd || invalidRange ? "is-warning" : ""
          }`}
        >
          {chapterStoryTimeLabel(chapter, timeline, system, t)}
        </span>
        <ChevronDown aria-hidden="true" />
      </summary>
      {expanded && (
        <div className="binder-story-time-panel">
          <p className="binder-story-time-help">{t("chapterStoryTimeHelp")}</p>
          <SegmentedControl
            className="binder-story-time-mode"
            label={t("chapterStoryTimeMode")}
            value={mode}
            onChange={setMode}
            size="compact"
            options={[
              { value: "open", label: t("chapterStoryTimeOpenMode") },
              { value: "point", label: t("chapterStoryTimePoint"), disabled: !timeline.length },
              { value: "range", label: t("chapterStoryTimeRange"), disabled: timeline.length < 2 },
            ]}
          />
          {!timeline.length && (
            <p className="binder-story-time-status">{t("chapterStoryTimeEmpty")}</p>
          )}
          {mode !== "open" && timeline.length > 0 && (
            <div className="binder-story-time-fields">
              <div className="binder-story-time-field">
                <span>
                  {mode === "range" ? t("chapterStoryTimeStart") : t("chapterStoryTimePoint")}
                </span>
                <ListboxSelect
                  className="binder-story-time-select"
                  label={mode === "range" ? t("chapterStoryTimeStart") : t("chapterStoryTimePoint")}
                  value={startMomentId}
                  options={startOptions}
                  onChange={(nextStartMomentId) => {
                    if (mode === "point") {
                      onChange({ startMomentId: nextStartMomentId });
                      return;
                    }
                    const nextStartPosition = positions.get(nextStartMomentId) ?? 0;
                    const nextEndMomentId =
                      momentsById.has(endMomentId) &&
                      (positions.get(endMomentId) ?? -1) > nextStartPosition
                        ? endMomentId
                        : timeline[nextStartPosition + 1]?.id;
                    if (!nextEndMomentId) return;
                    onChange({
                      startMomentId: nextStartMomentId,
                      endMomentId: nextEndMomentId,
                    });
                  }}
                />
              </div>
              {mode === "range" && (
                <div className="binder-story-time-field">
                  <span>{t("chapterStoryTimeEnd")}</span>
                  <ListboxSelect
                    className="binder-story-time-select"
                    label={t("chapterStoryTimeEnd")}
                    value={endMomentId}
                    options={endOptions}
                    onChange={(nextEndMomentId) =>
                      onChange({ startMomentId, endMomentId: nextEndMomentId })
                    }
                  />
                </div>
              )}
            </div>
          )}
          {(missingStart || missingEnd || invalidRange) && (
            <p className="binder-story-time-status is-warning">
              {invalidRange ? t("chapterStoryTimeInvalidRange") : t("chapterStoryTimeMissingHelp")}
            </p>
          )}
        </div>
      )}
    </details>
  );
}
