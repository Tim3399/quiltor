import type { MessageKey } from "../../../i18n";
import type { MapScale } from "../model";
import { formatPlaceNumber, parsePlaceNumber } from "./placeNumber";

/** The physical distance between two adjacent grid lines, when a scale exists. */
export function physicalGridDistance(
  scale: MapScale | undefined,
  gridSize: number,
): number | undefined {
  if (
    !scale ||
    !Number.isFinite(scale.unitsPer100px) ||
    scale.unitsPer100px <= 0 ||
    !Number.isFinite(gridSize) ||
    gridSize <= 0
  )
    return undefined;
  return (gridSize / 100) * scale.unitsPer100px;
}

/** A real 1/2/5 distance whose projected length stays near the requested screen width. */
export function mapScaleBar(
  scale: MapScale | undefined,
  zoom: number,
  targetWidth = 110,
): { distance: number; width: number } | undefined {
  const unitsPerPixel = physicalGridDistance(scale, 1);
  if (
    !unitsPerPixel ||
    !Number.isFinite(zoom) ||
    zoom <= 0 ||
    !Number.isFinite(targetWidth) ||
    targetWidth <= 0
  )
    return undefined;
  const targetDistance = (targetWidth / zoom) * unitsPerPixel;
  if (!Number.isFinite(targetDistance) || targetDistance <= 0) return undefined;
  const power = 10 ** Math.floor(Math.log10(targetDistance));
  const distance = [1, 2, 5, 10]
    .map((factor) => factor * power)
    .reduce((best, candidate) =>
      Math.abs(Math.log(candidate / targetDistance)) < Math.abs(Math.log(best / targetDistance))
        ? candidate
        : best,
    );
  const width = (distance / unitsPerPixel) * zoom;
  return Number.isFinite(width) && width > 0 ? { distance, width } : undefined;
}

export interface MapPoint {
  mapX: number;
  mapY: number;
}

export interface IdentifiedMapPoint extends MapPoint {
  id: string;
}

export interface MapDistancePair {
  id: string;
  from: string;
  to: string;
  distance: number;
}

export function mapDistance(a: MapPoint, b: MapPoint): number {
  return Math.hypot(b.mapX - a.mapX, b.mapY - a.mapY);
}

export function mapDistancePair(
  first: IdentifiedMapPoint,
  second: IdentifiedMapPoint,
): MapDistancePair {
  const [from, to] = first.id.localeCompare(second.id) <= 0 ? [first, second] : [second, first];
  return {
    id: `distance:${encodeURIComponent(from.id)}:${encodeURIComponent(to.id)}`,
    from: from.id,
    to: to.id,
    distance: mapDistance(from, to),
  };
}

export function allMapDistances(points: IdentifiedMapPoint[]): MapDistancePair[] {
  const ordered = [...points].sort((a, b) => a.id.localeCompare(b.id));
  const distances: MapDistancePair[] = [];
  for (let fromIndex = 0; fromIndex < ordered.length; fromIndex += 1) {
    for (let toIndex = fromIndex + 1; toIndex < ordered.length; toIndex += 1) {
      distances.push(mapDistancePair(ordered[fromIndex], ordered[toIndex]));
    }
  }
  return distances;
}

export function nearestMapDistances(
  points: IdentifiedMapPoint[],
  neighboursPerPlace = 3,
): MapDistancePair[] {
  const limit = Math.max(0, Math.floor(neighboursPerPlace));
  if (!limit || points.length < 2) return [];

  const ordered = [...points].sort((a, b) => a.id.localeCompare(b.id));
  const distances = new Map<string, MapDistancePair>();
  for (const from of ordered) {
    const nearest = ordered
      .filter((candidate) => candidate.id !== from.id)
      .map((to) => ({ to, pair: mapDistancePair(from, to) }))
      .sort((a, b) => a.pair.distance - b.pair.distance || a.to.id.localeCompare(b.to.id))
      .slice(0, limit);
    for (const { pair } of nearest) distances.set(pair.id, pair);
  }
  return [...distances.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * What a hundred pixels mean here, in one phrase.
 *
 * Said where the level is named rather than only where a distance is drawn:
 * two-stage scales raise the question the moment they exist, and the answer
 * belongs beside the thing that decides it.
 */
export function formatScale(
  scale: { unitsPer100px: number; unitLabel: string } | undefined,
  t: (key: MessageKey) => string,
  locale: string,
): string {
  if (!scale) return "";
  // Three significant digits: a scale taken from a measured stretch is kept exact
  // (66.666...), but nobody reads more of it than this.
  const shown = formatPlaceNumber(scale.unitsPer100px, locale, { significant: 3 });
  return `${shown} ${scale.unitLabel} ${t("perHundredPx")}`;
}

/**
 * The scale that makes a measured stretch as long as the author says it is.
 *
 * `flowLength` is the stretch on the surface, in the same units every distance here
 * is taken in. Under one unit it is a slip of the pointer, not a measurement.
 */
export function scaleFromMeasurement(
  flowLength: number,
  length: number,
  unitLabel: string,
): MapScale | undefined {
  if (!Number.isFinite(flowLength) || flowLength < 1) return undefined;
  if (!Number.isFinite(length) || length <= 0) return undefined;
  return { unitsPer100px: (length * 100) / flowLength, unitLabel };
}

/** A typed scale, or nothing when it is not one the server would accept (> 0). */
export function parseScaleInput(text: string, locale: string): number | undefined {
  const value = parsePlaceNumber(text, locale);
  return value !== undefined && value > 0 ? value : undefined;
}

export function formatDistance(
  distance: number,
  t: (key: MessageKey) => string,
  scale: { unitsPer100px: number; unitLabel: string } | undefined,
  locale: string,
): string {
  if (!scale) return t("unitsNoScale").replace("{n}", String(Math.round(distance)));
  const units = (distance / 100) * scale.unitsPer100px;
  return `${formatPlaceNumber(units, locale, { fraction: 2 })} ${scale.unitLabel}`;
}

/** How a frame resize began: its drawn size then, and whether it may distort. */
export type ResizeGesture = {
  start: { x: number; y: number; width: number; height: number };
  /** Shift was held as the gesture began: the frame may change its proportions. */
  free: boolean;
};

/**
 * What a finished frame resize does to the map's scale.
 *
 * Kept in proportion, a larger frame is the same ground drawn closer, so a hundred pixels
 * cover less of it: the scale is divided by the factor. The factor comes from the frame as
 * drawn when the gesture began, not from what is stored, because the resizer works from
 * the drawn, whole-pixel size. A distorted frame cannot be read in one scale; it keeps the
 * old one and says so. Without a gesture, a scale or a usable factor nothing changes.
 */
export function rescaledScale(
  scale: MapScale | undefined,
  gesture: ResizeGesture | null | undefined,
  box: { width: number; height: number },
): { scale?: MapScale; distorted: boolean } {
  if (!scale || !gesture) return { distorted: false };
  const { start } = gesture;
  if (box.width === start.width && box.height === start.height) return { distorted: false };
  if (gesture.free) return { distorted: true };
  const factor = box.width / start.width;
  if (!Number.isFinite(factor) || factor <= 0) return { distorted: false };
  return { scale: { ...scale, unitsPer100px: scale.unitsPer100px / factor }, distorted: false };
}

/**
 * The scale after the picture was zoomed inside its frame: zooming in by `z` puts `z`
 * times less ground into the same frame. Moving the picture changes nothing.
 */
export function zoomRescaledScale(
  scale: MapScale | undefined,
  previousZoom: number,
  nextZoom: number,
): MapScale | undefined {
  if (!scale) return undefined;
  const factor = nextZoom / previousZoom;
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return undefined;
  return { ...scale, unitsPer100px: scale.unitsPer100px / factor };
}
