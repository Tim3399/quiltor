import type { Viewport } from "@xyflow/react";
import type { FigureNode } from "../model";
import { isExpandedMap } from "./placeCanvasModel";
import { type LevelRect, placesOnLevel } from "./placeLevels";

export interface ActivePlaceMap {
  levelId: string | undefined;
  mapId: string;
}

/** A remembered map is meaningful only on the level where it was activated. */
export function resolveActivePlaceMap(
  nodes: readonly FigureNode[],
  levelId: string | undefined,
  active: ActivePlaceMap | undefined,
): FigureNode | undefined {
  const maps = placesOnLevel(nodes, levelId).filter(isExpandedMap);
  const remembered =
    active && active.levelId === levelId ? maps.find((map) => map.id === active.mapId) : undefined;
  return remembered ?? (maps.length === 1 ? maps[0] : undefined);
}

/** Selecting a direct child works on its host map without selecting the host. */
export function activePlaceMapForSelection(
  nodes: readonly FigureNode[],
  levelId: string | undefined,
  selectedId: string,
): FigureNode | undefined {
  const selected = nodes.find((node) => node.id === selectedId);
  return placesOnLevel(nodes, levelId)
    .filter(isExpandedMap)
    .find((map) => map.id === selectedId || map.id === selected?.parentPlaceId);
}

export interface MapChromeSize {
  headerHeight: number;
  footerHeight: number;
}

export interface MapChromeLayout {
  left: number;
  width: number;
  headerTop: number;
  footerTop: number;
  imageTop: number;
  imageHeight: number;
  frameHeight: number;
}

export interface MapChromeFooterArea {
  bounds: LevelRect;
  obstacles: LevelRect[];
}

/** Project only the world rectangle; bars never contribute to its size. */
export function projectMapChrome(
  map: LevelRect,
  viewport: Viewport,
  safe: LevelRect,
  measuredSize?: MapChromeSize & { measuredWidth?: number },
  footerArea?: MapChromeFooterArea,
): MapChromeLayout | undefined {
  if (
    ![
      map.x,
      map.y,
      map.width,
      map.height,
      viewport.x,
      viewport.y,
      viewport.zoom,
      safe.x,
      safe.y,
      safe.width,
      safe.height,
    ].every(Number.isFinite)
  )
    return undefined;
  if (viewport.zoom <= 0 || map.width <= 0 || map.height <= 0) return undefined;
  const mapLeft = viewport.x + map.x * viewport.zoom;
  const mapTop = viewport.y + map.y * viewport.zoom;
  const mapRight = mapLeft + map.width * viewport.zoom;
  const mapBottom = mapTop + map.height * viewport.zoom;
  const left = Math.max(safe.x, mapLeft);
  const right = Math.min(safe.x + safe.width, mapRight);
  const visibleTop = Math.max(safe.y, mapTop);
  const visibleBottom = Math.min(safe.y + safe.height, mapBottom);
  const width = right - left;
  // A clipped corner cannot carry two useful, attached bars.
  if (width < 240 || visibleBottom - visibleTop < 100) return undefined;
  // A measurement from another density must not hide the new layout before its
  // compact bars have had the chance to mount and report their own height.
  const density = (value: number) => (value < 400 ? 0 : value < 620 ? 1 : 2);
  const size =
    measuredSize?.measuredWidth === undefined ||
    density(measuredSize.measuredWidth) === density(width)
      ? measuredSize
      : undefined;
  const headerHeight = size?.headerHeight ?? 46;
  const headerTop = Math.max(safe.y, mapTop - headerHeight);
  const footerBounds = footerArea?.bounds ?? safe;
  const footerHeight = size?.footerHeight ?? 42;
  let footerTop = Math.min(footerBounds.y + footerBounds.height - footerHeight, mapBottom);
  // A frame has one left and right edge. If a dock occupies the footer row,
  // keep the complete instrument strip and move it above that dock.
  let moved = true;
  while (moved) {
    moved = false;
    for (const obstacle of footerArea?.obstacles ?? []) {
      if (
        footerTop >= obstacle.y + obstacle.height ||
        footerTop + footerHeight <= obstacle.y ||
        left >= obstacle.x + obstacle.width ||
        right <= obstacle.x
      )
        continue;
      footerTop = obstacle.y - footerHeight;
      moved = true;
    }
  }
  const imageTop = Math.max(mapTop, headerTop + headerHeight);
  const imageBottom = Math.min(mapBottom, footerTop);
  if (imageBottom - imageTop < 24) return undefined;
  return {
    left,
    width,
    headerTop,
    footerTop,
    imageTop,
    imageHeight: imageBottom - imageTop,
    frameHeight: footerTop + footerHeight - headerTop,
  };
}

/** Convert the visible screen-space image back into insets on its world rectangle. */
export function projectMapVisualClip(
  mapId: string,
  map: LevelRect,
  viewport: Viewport,
  layout: MapChromeLayout,
) {
  const mapLeft = viewport.x + map.x * viewport.zoom;
  const mapTop = viewport.y + map.y * viewport.zoom;
  const mapRight = mapLeft + map.width * viewport.zoom;
  const mapBottom = mapTop + map.height * viewport.zoom;
  const imageRight = layout.left + layout.width;
  const imageBottom = layout.imageTop + layout.imageHeight;
  const inset = (value: number, extent: number) => Math.min(extent, Math.max(0, value));
  return {
    mapId,
    bounds: {
      x: (layout.left - viewport.x) / viewport.zoom,
      y: (layout.imageTop - viewport.y) / viewport.zoom,
      width: layout.width / viewport.zoom,
      height: layout.imageHeight / viewport.zoom,
    },
    top: inset((layout.imageTop - mapTop) / viewport.zoom, map.height),
    right: inset((mapRight - imageRight) / viewport.zoom, map.width),
    bottom: inset((mapBottom - imageBottom) / viewport.zoom, map.height),
    left: inset((layout.left - mapLeft) / viewport.zoom, map.width),
  };
}
