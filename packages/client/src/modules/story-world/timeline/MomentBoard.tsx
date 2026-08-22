import { useState } from "react";
import { Clock3, GripVertical } from "lucide-react";
import type { FigureState, TimeSystem, TimelineMoment } from "../model";
import type { Translate } from "../../../i18n";
import { countMomentChanges, momentTimeLabel } from "./timelinePresentation";
import "./MomentBoard.css";

export function MomentBoard({
  state,
  timeline,
  system,
  selectedId,
  onSelect,
  onMove,
  t,
}: {
  state: FigureState;
  timeline: TimelineMoment[];
  system: TimeSystem;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, index: number) => void;
  t: Translate;
}) {
  const [draggedMomentId, setDraggedMomentId] = useState<string | null>(null);
  if (!timeline.length) {
    return (
      <div className="timeline-manager-empty">
        <Clock3 />
        <h2>{t("timelineEmptyTitle")}</h2>
        <p>{t("timelineEmptyHelp")}</p>
      </div>
    );
  }
  return (
    <nav className="story-timeline" aria-label={t("timeline")}>
      <div className="story-track">
        {timeline.map((moment, index) => (
          <div className="story-moment-wrap" key={moment.id}>
            <button
              draggable
              className={`story-moment ${moment.id === selectedId ? "active" : ""}`}
              aria-current={moment.id === selectedId ? "step" : undefined}
              onDragStart={() => setDraggedMomentId(moment.id)}
              onDragEnd={() => setDraggedMomentId(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (draggedMomentId) onMove(draggedMomentId, index);
                setDraggedMomentId(null);
              }}
              onClick={() => onSelect(moment.id)}
            >
              <GripVertical aria-hidden="true" />
              <span>{index + 1}</span>
              <strong>{moment.title || t("untitled")}</strong>
              <small>
                {momentTimeLabel(system, moment, index, t)} ·{" "}
                {t("nChanges", { n: countMomentChanges(state, moment.id) })}
              </small>
            </button>
          </div>
        ))}
      </div>
    </nav>
  );
}
