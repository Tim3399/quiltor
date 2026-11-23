import { Alert, Button } from "../../../design";
import { useI18n } from "../../../i18n";
import "./PlaceMapEdgeHint.css";

/**
 * Said once, where a zoom-out runs into the edge of the map.
 *
 * Without it the minus button simply stops, and nothing says that the stop is a
 * setting rather than a limit of the canvas. The action is the setting.
 */
export function PlaceMapEdgeHint({ onZoomOutFurther }: { onZoomOutFurther: () => void }) {
  const { t } = useI18n();
  return (
    <Alert
      className="place-map-edge-hint"
      role="status"
      tone="info"
      action={
        <Button size="compact" onClick={onZoomOutFurther}>
          {t("zoomOutFurther")}
        </Button>
      }
    >
      {t("mapEdgeReached")}
    </Alert>
  );
}
