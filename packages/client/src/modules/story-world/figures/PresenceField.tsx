import { useI18n } from "../../../i18n";
import type { FigureNode, FigureState, PresenceEntry, TimelineMoment } from "../model";
import {
  figureJourney,
  momentIndex,
  patchPresence,
  presenceFieldEditor,
  stopDateDiff,
} from "./presence";
import "./PresenceField.css";

const EMPTY_TIMELINE: TimelineMoment[] = [];
const EMPTY_PRESENCE: PresenceEntry[] = [];

export type PresenceFieldProps = {
  figure: FigureNode;
  state: FigureState;
  activeMomentId: string | null;
  onState: (state: FigureState) => void;
  onSelectMoment: (id: string | null) => void;
};

export function PresenceField({
  figure,
  state,
  activeMomentId,
  onState,
  onSelectMoment,
}: PresenceFieldProps) {
  const { t } = useI18n();
  const timeline = state.timeline ?? EMPTY_TIMELINE;
  const presence = state.presence ?? EMPTY_PRESENCE;
  const places = state.nodes.filter((node) => node.type === "ort");
  const editor = presenceFieldEditor(figure.id, presence, timeline, activeMomentId);
  const inheritedName = editor.inheritedPlaceId
    ? state.nodes.find((node) => node.id === editor.inheritedPlaceId)?.name
    : undefined;
  const stops = figureJourney(figure, presence, timeline);
  const activeIndex = activeMomentId ? momentIndex(timeline, activeMomentId) : -1;
  const currentStopIndex = stops.reduce<number>(
    (found, stop, index) => (stop.index <= activeIndex ? index : found),
    -1,
  );
  const fieldLabelId = `figure-presence-${figure.id}`;
  return (
    <div className="presence-field-group">
      <div className="field presence-field">
        <span id={fieldLabelId}>
          {activeMomentId
            ? t("placeSinceMoment").replace(
                "{title}",
                timeline.find((moment) => moment.id === activeMomentId)?.title ?? "",
              )
            : t("placeInitial")}
        </span>
        {places.length ? (
          <select
            aria-labelledby={fieldLabelId}
            value={editor.placeId}
            onChange={(event) =>
              onState({
                ...state,
                presence: patchPresence(
                  presence,
                  figure.id,
                  activeMomentId,
                  event.target.value || null,
                ),
              })
            }
          >
            <option value="">
              {activeMomentId
                ? `${t("unchanged")}${inheritedName ? ` · ${inheritedName}` : ""}`
                : t("noPlace")}
            </option>
            {places.map((place) => (
              <option key={place.id} value={place.id}>
                {place.name}
              </option>
            ))}
          </select>
        ) : (
          <p className="muted">{t("createPlaceFirst")}</p>
        )}
      </div>
      {stops.length > 0 && (
        <div className="presence-journey">
          {stops.flatMap((stop, index) => {
            const place = state.nodes.find((node) => node.id === stop.placeId);
            const button = (
              <button
                type="button"
                key={stop.momentId ?? "base"}
                className={index === currentStopIndex ? "active" : ""}
                onClick={() => onSelectMoment(stop.momentId ?? null)}
              >
                {place?.name ?? t("unknown")}
              </button>
            );
            return index > 0
              ? [
                  <small
                    key={`gap-${stop.momentId ?? "base"}`}
                    className="presence-journey-duration"
                  >
                    {stopDateDiff(stops[index - 1], stop, timeline, state.timeSystem).label}
                  </small>,
                  button,
                ]
              : [button];
          })}
        </div>
      )}
    </div>
  );
}
