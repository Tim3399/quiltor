import { useI18n } from "../../../i18n";
import type { MapScale } from "../model";
import { PlaceMapActions, type PlaceMapActionsProps } from "./PlaceMapActions";
import { PlaceMapScaleControl } from "./PlaceMapScaleControl";
import "./PlaceMapToolbar.css";

/** Collapsed maps keep their reachable card toolbar beside the canvas. */
export function PlaceMapToolbar({
  measured,
  scale,
  onScale,
  ...actions
}: PlaceMapActionsProps & {
  measured: string;
  scale: MapScale | undefined;
  onScale: (patch: Partial<MapScale>) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="place-map-toolbar" role="toolbar" aria-label={t("placeMapActions")}>
      <span className="place-map-toolbar__name">{actions.map.name}</span>
      <span className="place-map-toolbar__measure">
        {actions.adjusting && actions.expanded
          ? `${Math.round(actions.crop.zoom * 100)} %`
          : measured}
      </span>
      {actions.adjusting ? null : (
        <PlaceMapScaleControl
          key={actions.map.id}
          name={actions.map.name}
          scale={scale}
          onScale={onScale}
        />
      )}
      <PlaceMapActions {...actions} />
    </div>
  );
}
