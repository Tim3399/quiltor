import { Ruler } from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button, TextField } from "../../../design";
import { useI18n } from "../../../i18n";
import { ModeBanner } from "../ModeBanner";
import type { MapScale } from "../model";
import { type MeasureTarget, measureClickTarget } from "./placeCanvasModel";
import { scaleFromMeasurement } from "./placeMap";
import { formatPlaceNumber, parsePlaceNumber } from "./placeNumber";
import "./PlaceScaleCalibration.css";

/** Below this many screen pixels a press and release is a click, not a stretch. */
const CALIBRATION_DRAG_THRESHOLD = 4;

type Point = { x: number; y: number };

/** The place under a screen point, if a place (not a map or a picture) is there. */
export function placeAt(client: Point): string | undefined {
  const node = document
    .elementFromPoint(client.x, client.y)
    ?.closest<HTMLElement>(".react-flow__node[data-id]");
  const id = node?.dataset.id;
  if (!node || !id) return undefined;
  const typeClass = [...node.classList].find((name) => name.startsWith("react-flow__node-"));
  const type = typeClass?.slice("react-flow__node-".length) ?? "";
  return measureClickTarget(type, id) === "place" ? id : undefined;
}

/**
 * Drawing a stretch by dragging, on the flow's own wrapper rather than a layer over it.
 *
 * Clicks are left alone: they reach the nodes and the pane as always and set an end
 * there. Only a press that travels further than the threshold becomes a stretch, and
 * the click the browser sends after it is swallowed so it cannot set a third end. A
 * second finger means a pinch, which belongs to the canvas: the stretch is dropped.
 */
export function useCalibrationGesture({
  active,
  toFlow,
  targetAt,
  onStart,
  onPreview,
  onEnd,
}: {
  active: boolean;
  toFlow: (client: Point) => Point | undefined;
  /** What an end at this screen point is: the place there, or a free point. */
  targetAt: (client: Point) => MeasureTarget | undefined;
  onStart: (start: MeasureTarget) => void;
  onPreview: (point: Point) => void;
  onEnd: (end: MeasureTarget) => void;
}) {
  const pointers = useRef(new Set<number>());
  const draft = useRef<{
    pointerId: number;
    from: Point;
    start: MeasureTarget | undefined;
    dragging: boolean;
  } | null>(null);
  const swallowClick = useRef(false);
  // A stretch half drawn when the mode ends must not come back with the next one.
  useEffect(() => {
    if (active) return;
    pointers.current.clear();
    draft.current = null;
    swallowClick.current = false;
  }, [active]);

  const client = (event: { clientX: number; clientY: number }) => ({
    x: event.clientX,
    y: event.clientY,
  });

  return {
    onPointerDownCapture: (event: ReactPointerEvent) => {
      if (!active) return;
      pointers.current.add(event.pointerId);
      if (pointers.current.size > 1) {
        draft.current = null;
        return;
      }
      if (!event.isPrimary || event.button !== 0) return;
      draft.current = {
        pointerId: event.pointerId,
        from: client(event),
        start: targetAt(client(event)),
        dragging: false,
      };
    },
    onPointerMoveCapture: (event: ReactPointerEvent) => {
      if (!active) return;
      const current = draft.current;
      if (current && current.pointerId === event.pointerId) {
        const point = client(event);
        if (
          !current.dragging &&
          Math.hypot(point.x - current.from.x, point.y - current.from.y) >=
            CALIBRATION_DRAG_THRESHOLD
        ) {
          current.dragging = true;
          if (current.start) onStart(current.start);
        }
        if (!current.dragging) return;
      }
      const flow = toFlow(client(event));
      if (flow) onPreview(flow);
    },
    onPointerUpCapture: (event: ReactPointerEvent) => {
      pointers.current.delete(event.pointerId);
      const current = draft.current;
      draft.current = null;
      if (!active || !current?.dragging || current.pointerId !== event.pointerId) return;
      const end = targetAt(client(event));
      if (current.start && end) onEnd(end);
      swallowClick.current = true;
    },
    onPointerCancelCapture: (event: ReactPointerEvent) => {
      pointers.current.delete(event.pointerId);
      draft.current = null;
    },
    onClickCapture: (event: ReactMouseEvent) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      event.stopPropagation();
      event.preventDefault();
    },
  };
}

/**
 * Setting a scale by measuring: the banner, and the length the stretch stands for.
 *
 * The stretch is drawn on the surface itself (two clicks, or one drag); this only says
 * what to do next and turns the stretch and the typed length into a scale.
 */
export function PlaceScaleCalibration({
  ends,
  flowLength,
  defaultUnit,
  trail,
  onApply,
  onCancel,
}: {
  /** How many ends of the stretch are set: 0, 1 or 2. */
  ends: number;
  /** The stretch in flow units, once both ends are set. */
  flowLength: number | undefined;
  defaultUnit: string;
  trail?: ReactNode;
  onApply: (scale: MapScale) => void;
  onCancel: () => void;
}) {
  const { t, locale } = useI18n();
  const [length, setLength] = useState("");
  const [unit, setUnit] = useState(defaultUnit);
  const scale =
    ends === 2 && flowLength !== undefined
      ? scaleFromMeasurement(flowLength, parsePlaceNumber(length, locale) ?? Number.NaN, unit)
      : undefined;
  const tooShort = ends === 2 && flowLength !== undefined && flowLength < 1;
  return (
    <div className="places-measure-overlays places-scale-calibration">
      {trail}
      <ModeBanner
        tone="info"
        icon={<Ruler />}
        dismissLabel={t("calibrateCancel")}
        onDismiss={onCancel}
      >
        <span>{ends === 0 ? t("calibrateStartHint") : t("calibrateEndHint")}</span>
      </ModeBanner>
      <form
        className="places-scale-calibration__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (scale) onApply(scale);
        }}
      >
        <TextField
          fieldClassName="places-scale-calibration__length"
          label={t("calibrateLength")}
          inputMode="decimal"
          value={length}
          onChange={(event) => setLength(event.target.value)}
        />
        <TextField
          fieldClassName="places-scale-calibration__unit"
          label={t("unitLabelField")}
          value={unit}
          onChange={(event) => setUnit(event.target.value)}
        />
        <Button type="submit" size="compact" appearance="primary" disabled={!scale}>
          {t("calibrateApply")}
        </Button>
        <output className="places-scale-calibration__preview" aria-live="polite">
          {tooShort
            ? t("calibrateTooShort")
            : scale
              ? t("calibratePreview", {
                  value: formatPlaceNumber(scale.unitsPer100px, locale, { significant: 3 }),
                  unit: scale.unitLabel,
                })
              : ""}
        </output>
      </form>
    </div>
  );
}
