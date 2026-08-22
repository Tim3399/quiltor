import { useMemo } from "react";
import { useI18n } from "../../../i18n";
import type { Workspace } from "../../../shared";
import { placeChronicle, placeJourney, stopDateDiff } from "../figures/presence";
import type { FigureNode, FigureState } from "../model";

export function PlaceHistory({
  place,
  state,
  onOpen,
}: {
  place: FigureNode;
  state: FigureState;
  onOpen: (target: { workspace: Workspace; id: string }) => void;
}) {
  const { t } = useI18n();
  const timeline = state.timeline ?? [];
  const presence = state.presence ?? [];
  const stays = useMemo(
    () => placeJourney(place.id, state.nodes, presence, timeline),
    [place.id, state.nodes, presence, timeline],
  );
  const chronicle = useMemo(
    () => placeChronicle(place.id, state.nodes, presence, timeline),
    [place.id, state.nodes, presence, timeline],
  );
  return (
    <div className="panel-body places-inspector-body">
      <details className="places-manager-section" open>
        <summary>
          <div>
            <h2>{t("whoWasHere")}</h2>
            <p>{t("whoWasHereBody")}</p>
          </div>
        </summary>
        <div className="places-stay-table">
          {stays.map((stay) => {
            const figure = state.nodes.find((node) => node.id === stay.elementId);
            if (!figure) return null;
            const stayKey = [
              stay.elementId,
              stay.arrivedAt.momentId ?? "base",
              stay.leftAt?.momentId ?? "present",
            ].join(":");
            return (
              <div key={stayKey}>
                <button
                  type="button"
                  className="places-link"
                  onClick={() => onOpen({ workspace: "figures", id: figure.id })}
                >
                  {figure.name}
                </button>
                <span>
                  {stay.arrivedAt.momentId
                    ? timeline.find((moment) => moment.id === stay.arrivedAt.momentId)?.title
                    : t("initialState")}
                </span>
                <span>
                  {stay.leftAt
                    ? stay.died
                      ? `† ${timeline.find((moment) => moment.id === stay.leftAt?.momentId)?.title ?? ""}`
                      : timeline.find((moment) => moment.id === stay.leftAt?.momentId)?.title
                    : t("stillHere")}
                </span>
                <span className="places-stay-duration">
                  {stay.leftAt
                    ? stopDateDiff(stay.arrivedAt, stay.leftAt, timeline, state.timeSystem).label
                    : ""}
                </span>
              </div>
            );
          })}
          {!stays.length && <p className="places-section-empty">{t("noOneHereYet")}</p>}
        </div>
      </details>
      <details className="places-manager-section" open>
        <summary>
          <div>
            <h2>{t("chronicle")}</h2>
            <p>{t("chronicleBody")}</p>
          </div>
        </summary>
        <div className="places-chronicle-list">
          {chronicle.map((row) => {
            const moment = row.moment;
            return (
              <div key={row.index}>
                <strong>
                  {moment ? (
                    <button
                      type="button"
                      className="places-link"
                      onClick={() => onOpen({ workspace: "timeline", id: moment.id })}
                    >
                      {moment.title}
                    </button>
                  ) : (
                    t("initialState")
                  )}
                </strong>
                <span>
                  {row.occupants.length
                    ? row.occupants.map((node) => node.name).join(", ")
                    : t("nobodyHere")}
                </span>
                {!!row.arrived.length && (
                  <small>
                    {t("arrived")}: {row.arrived.map((node) => node.name).join(", ")}
                  </small>
                )}
                {!!row.left.length && (
                  <small>
                    {t("left")}: {row.left.map((node) => node.name).join(", ")}
                  </small>
                )}
              </div>
            );
          })}
          {!chronicle.length && <p className="places-section-empty">{t("noMovementYet")}</p>}
        </div>
      </details>
    </div>
  );
}
