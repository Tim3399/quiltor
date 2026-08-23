import { Clock3, Pause, Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../../../i18n";
import type { TimelineMoment } from "../model";
import { formatMomentDate } from "./date";
import "./TimelineStrip.css";

export type TimelineStripProps = {
  timeline: TimelineMoment[];
  activeId: string | null;
  playing: boolean;
  onPlay: () => void;
  onSelect: (id: string | null) => void;
  onAdd: (title: string, date?: string) => void;
  onPatch: (id: string, patch: Partial<TimelineMoment>) => void;
  onDelete: (moment: TimelineMoment) => void;
};

export function TimelineStrip({
  timeline,
  activeId,
  playing,
  onPlay,
  onSelect,
  onAdd,
  onPatch,
  onDelete,
}: TimelineStripProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const [draftDate, setDraftDate] = useState("");
  const add = () => {
    const title = draft.trim();
    if (!title) return;
    onAdd(title, draftDate || undefined);
    setDraft("");
    setDraftDate("");
  };
  const active = timeline.find((moment) => moment.id === activeId);
  return (
    <section
      className={`timeline-strip ${playing ? "is-playing" : ""}`}
      aria-label={t("timelineStripLabel")}
    >
      <div className="timeline-heading">
        <Clock3 />
        <span>{t("timeToggle")}</span>
        <button
          type="button"
          className="timeline-play"
          disabled={!timeline.length}
          aria-label={playing ? t("pauseTimeTravel") : t("playTimeTravel")}
          onClick={onPlay}
        >
          {playing ? <Pause /> : <Play />}
        </button>
        <button
          type="button"
          className={!activeId ? "active" : ""}
          aria-pressed={!activeId}
          onClick={() => onSelect(null)}
        >
          {t("overview")}
        </button>
      </div>
      <div className="timeline-track">
        {timeline.map((moment, index) => (
          <div className="timeline-moment" key={moment.id}>
            <span aria-hidden="true">{index + 1}</span>
            <button
              type="button"
              className={activeId === moment.id ? "active" : ""}
              aria-pressed={activeId === moment.id}
              onClick={() => onSelect(moment.id)}
            >
              <b>{moment.title}</b>
              {moment.date && <small>{formatMomentDate(moment.date)}</small>}
            </button>
          </div>
        ))}
      </div>
      <div className="timeline-add">
        <input
          className="timeline-title"
          aria-label={t("newMoment")}
          value={draft}
          placeholder={t("newMoment")}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <input
          className="timeline-date"
          type="date"
          aria-label={t("newMomentDate")}
          value={draftDate}
          onChange={(event) => setDraftDate(event.target.value)}
        />
        <button
          type="button"
          className="icon-button"
          disabled={!draft.trim()}
          aria-label={t("addMoment")}
          onClick={add}
        >
          <Plus />
        </button>
      </div>
      {active && (
        <div className="timeline-details">
          <label>
            <span>{t("name")}</span>
            <input
              value={active.title}
              onChange={(event) => onPatch(active.id, { title: event.target.value })}
            />
          </label>
          <label>
            <span>{t("optionalDate")}</span>
            <input
              type="date"
              value={active.date || ""}
              onChange={(event) => onPatch(active.id, { date: event.target.value || undefined })}
            />
          </label>
          <label>
            <span>{t("optionalNote")}</span>
            <input
              value={active.note || ""}
              placeholder={t("momentNotePlaceholder")}
              onChange={(event) => onPatch(active.id, { note: event.target.value })}
            />
          </label>
          <button
            type="button"
            className="icon-button danger-text"
            aria-label={t("deleteMoment")}
            onClick={() => onDelete(active)}
          >
            <Trash2 />
          </button>
        </div>
      )}
    </section>
  );
}
