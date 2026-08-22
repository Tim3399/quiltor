import { MapPin, Pin, Star, X } from "lucide-react";
import { useI18n } from "../../../i18n";
import type { Workspace } from "../../../shared";
import type { FigureNode, FigureState } from "../model";
import { PlaceHistory } from "./PlaceHistory";
import "./PlaceInspector.css";

export function PlaceInspector({
  selected,
  state,
  onPatch,
  onClose,
  onOpen,
}: {
  selected: FigureNode | null;
  state: FigureState;
  onPatch: (patch: Partial<FigureNode>) => void;
  onClose: () => void;
  onOpen: (target: { workspace: Workspace; id: string }) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <div className="panel-heading">
        <span>{selected ? selected.name : t("inspector")}</span>
        {selected && (
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label={t("closeSelection")}
          >
            <X />
          </button>
        )}
      </div>
      {!selected ? (
        <div className="empty-inspector">
          <MapPin />
          <h2>{t("selectPlace")}</h2>
          <p>{t("selectPlaceBody")}</p>
        </div>
      ) : (
        <>
          <div className="panel-body places-place-fields">
            <label className="field">
              <span>{t("name")}</span>
              <input
                value={selected.name}
                onChange={(event) => onPatch({ name: event.target.value })}
              />
            </label>
            <label className="field">
              <span>{t("shortDescription")}</span>
              <textarea
                value={selected.sub || ""}
                onChange={(event) => onPatch({ sub: event.target.value })}
              />
            </label>
            <div className="node-priority-actions">
              <button
                type="button"
                className={selected.important ? "active" : ""}
                aria-pressed={!!selected.important}
                onClick={() => onPatch({ important: !selected.important })}
              >
                <Star />
                {selected.important ? t("unfavoritePlace") : t("favoritePlace")}
              </button>
              <button
                type="button"
                className={selected.pinned ? "active" : ""}
                aria-pressed={!!selected.pinned}
                onClick={() => onPatch({ pinned: !selected.pinned })}
              >
                <Pin />
                {selected.pinned ? t("unlockPlacePosition") : t("lockPlacePosition")}
              </button>
            </div>
          </div>
          <PlaceHistory place={selected} state={state} onOpen={onOpen} />
        </>
      )}
    </>
  );
}
