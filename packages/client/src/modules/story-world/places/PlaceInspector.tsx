import { MapPin, Pin, Star, X } from "lucide-react";
import { Button, IconButton, TextArea, TextField } from "../../../design";
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
        {selected && <IconButton label={t("closeSelection")} icon={<X />} onClick={onClose} />}
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
            <TextField
              id="place-name"
              label={t("name")}
              value={selected.name}
              onChange={(event) => onPatch({ name: event.target.value })}
            />
            <TextArea
              id="place-short-description"
              label={t("shortDescription")}
              value={selected.sub || ""}
              onChange={(event) => onPatch({ sub: event.target.value })}
            />
            <div className="places-priority-actions">
              <Button
                className="places-priority-action"
                appearance={selected.important ? "primary" : "secondary"}
                icon={<Star />}
                aria-pressed={!!selected.important}
                onClick={() => onPatch({ important: !selected.important })}
              >
                {selected.important ? t("unfavoritePlace") : t("favoritePlace")}
              </Button>
              <Button
                className="places-priority-action"
                appearance={selected.pinned ? "primary" : "secondary"}
                icon={<Pin />}
                aria-pressed={!!selected.pinned}
                onClick={() => onPatch({ pinned: !selected.pinned })}
              >
                {selected.pinned ? t("unlockPlacePosition") : t("lockPlacePosition")}
              </Button>
            </div>
          </div>
          <PlaceHistory place={selected} state={state} onOpen={onOpen} />
        </>
      )}
    </>
  );
}
