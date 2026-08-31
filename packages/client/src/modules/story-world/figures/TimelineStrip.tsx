import { Clock3, Pause, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, IconButton, ScrollArea, TextField } from "../../../design";
import { useI18n } from "../../../i18n";
import { NoteEditor, noteFocusCopy } from "../../notes";
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
  const trackRef = useRef<HTMLDivElement>(null);
  const add = () => {
    const title = draft.trim();
    if (!title) return;
    onAdd(title, draftDate || undefined);
    setDraft("");
    setDraftDate("");
  };
  const active = timeline.find((moment) => moment.id === activeId);

  useEffect(() => {
    if (!playing || !activeId) return;
    const activeMoment = Array.from(
      trackRef.current?.querySelectorAll<HTMLElement>("[data-timeline-moment-id]") ?? [],
    ).find((element) => element.dataset.timelineMomentId === activeId);
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    activeMoment?.scrollIntoView?.({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [activeId, playing]);

  return (
    <section
      className={`timeline-strip ${playing ? "is-playing" : ""}`}
      aria-label={t("timelineStripLabel")}
    >
      <div className="timeline-heading">
        <Clock3 />
        <span>{t("timeToggle")}</span>
        <IconButton
          className="timeline-heading-action timeline-play"
          disabled={!timeline.length}
          label={playing ? t("pauseTimeTravel") : t("playTimeTravel")}
          icon={playing ? <Pause /> : <Play />}
          onClick={onPlay}
        />
        <Button
          size="compact"
          className={`timeline-heading-action timeline-overview ${!activeId ? "active" : ""}`}
          aria-pressed={!activeId}
          onClick={() => onSelect(null)}
        >
          {t("overview")}
        </Button>
      </div>
      <ScrollArea ref={trackRef} axis="x" className="timeline-track" surface="panel">
        {timeline.map((moment, index) => (
          <div className="timeline-moment" data-timeline-moment-id={moment.id} key={moment.id}>
            <span aria-hidden="true">{index + 1}</span>
            <Button
              size="compact"
              className={`timeline-moment-button ${activeId === moment.id ? "active" : ""}`}
              aria-pressed={activeId === moment.id}
              onClick={() => onSelect(moment.id)}
            >
              <span className="timeline-moment-copy">
                <b>{moment.title}</b>
                {moment.date && <small>{formatMomentDate(moment.date)}</small>}
              </span>
            </Button>
          </div>
        ))}
      </ScrollArea>
      <div className="timeline-add">
        <TextField
          fieldClassName="timeline-title-field"
          className="timeline-title"
          label={t("newMoment")}
          labelHidden
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
        <TextField
          fieldClassName="timeline-date-field"
          className="timeline-date"
          type="date"
          label={t("newMomentDate")}
          labelHidden
          value={draftDate}
          onChange={(event) => setDraftDate(event.target.value)}
        />
        <IconButton
          className="timeline-add-action"
          disabled={!draft.trim()}
          label={t("addMoment")}
          icon={<Plus />}
          onClick={add}
        />
      </div>
      {active && (
        <div className="timeline-details">
          <TextField
            fieldClassName="timeline-detail-field"
            className="timeline-detail-input"
            label={t("name")}
            value={active.title}
            onChange={(event) => onPatch(active.id, { title: event.target.value })}
          />
          <TextField
            fieldClassName="timeline-detail-field"
            className="timeline-detail-input"
            label={t("optionalDate")}
            type="date"
            value={active.date || ""}
            onChange={(event) => onPatch(active.id, { date: event.target.value || undefined })}
          />
          <NoteEditor
            owner={{ kind: "timeline", id: active.id }}
            fieldClassName="timeline-detail-field timeline-detail-note"
            className="timeline-detail-input"
            label={t("optionalNote")}
            value={active.note || ""}
            references={active.noteReferences}
            placeholder={t("momentNotePlaceholder")}
            onChange={(note, noteReferences) => onPatch(active.id, { note, noteReferences })}
            size="compact"
            focus={noteFocusCopy(t, active.title)}
          />
          <IconButton
            className="timeline-delete-action"
            tone="danger"
            label={t("deleteMoment")}
            icon={<Trash2 />}
            onClick={() => onDelete(active)}
          />
        </div>
      )}
    </section>
  );
}
