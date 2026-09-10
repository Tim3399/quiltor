import { useViewport } from "@xyflow/react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { PlaceMapChrome, type PlaceMapChromeProps } from "./PlaceMapChrome";
import { usePlaceMapVisualClipPublisher } from "./PlaceMapFrameContext";
import type { PlaceMapFlowNode } from "./PlaceMapNode";
import type { LevelRect } from "./placeLevels";
import {
  type MapChromeFooterArea,
  type MapChromeSize,
  projectMapChrome,
  projectMapVisualClip,
} from "./placeMapChromeModel";
import type { PlaceCanvasController } from "./usePlaceCanvas";

export type ActivePlaceMapChromeProps = Omit<PlaceMapChromeProps, "layout" | "zoom" | "onSize">;

/** The existing canvas overlay measures its own safe area, never the whole window. */
export function PlaceMapChromeOverlay({
  controller,
  chrome,
  measuring,
}: {
  controller: PlaceCanvasController;
  chrome: ActivePlaceMapChromeProps;
  measuring: boolean;
}) {
  const viewport = useViewport();
  const setVisualClip = usePlaceMapVisualClipPublisher();
  const boundary = useRef<HTMLDivElement>(null);
  const [safe, setSafe] = useState<{ bounds: LevelRect; footer: MapChromeFooterArea }>();
  const [size, setSize] = useState<MapChromeSize & { mapId: string; measuredWidth: number }>();
  const layoutWidth = useRef(0);
  const onSize = useCallback(
    (next: MapChromeSize) => {
      setSize((current) =>
        current?.mapId === chrome.map.id &&
        current.measuredWidth === layoutWidth.current &&
        current.headerHeight === next.headerHeight &&
        current.footerHeight === next.footerHeight
          ? current
          : {
              ...next,
              mapId: chrome.map.id,
              measuredWidth: layoutWidth.current,
            },
      );
    },
    [chrome.map.id],
  );

  useLayoutEffect(() => {
    void chrome.map.id;
    void measuring;
    const element = boundary.current;
    const surface = element?.parentElement;
    if (!element || !surface) return;
    const obstacleSelector =
      ".place-level-trail, .places-measure-overlays, .place-map-toolbar, .react-flow__controls, .react-flow__minimap";
    const measure = () => {
      const origin = surface.getBoundingClientRect();
      const bounds = element.getBoundingClientRect();
      let headerLeft = bounds.left;
      let top = bounds.top;
      let bottom = bounds.bottom;
      let headerBottom = bounds.bottom;
      let footerBottom = bounds.bottom;
      const obstacles: LevelRect[] = [];
      const gap =
        Number.parseFloat(getComputedStyle(surface).getPropertyValue("--graph-overlay-gap")) || 10;
      for (const obstacle of surface.querySelectorAll<HTMLElement>(obstacleSelector)) {
        const rect = obstacle.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        if (obstacle.matches(".place-map-toolbar") && rect.top > origin.top + origin.height / 2) {
          bottom = Math.min(bottom, rect.top - gap);
        } else if (
          obstacle.matches(".place-level-trail, .places-measure-overlays, .place-map-toolbar")
        ) {
          top = Math.max(top, rect.bottom + gap);
        } else if (obstacle.matches(".react-flow__controls") && rect.width > rect.height) {
          headerBottom = Math.min(headerBottom, rect.top - gap);
          footerBottom = Math.min(footerBottom, rect.top - gap);
        } else {
          if (obstacle.matches(".react-flow__controls")) {
            // A sticky header can cross any row after panning. Keep it beside
            // the tall touch dock; the footer still uses its actual row.
            headerLeft = Math.max(headerLeft, rect.right + gap);
          } else {
            headerBottom = Math.min(headerBottom, rect.top - gap);
          }
          // The overview and vertical touch dock only reduce a footer row
          // that actually crosses them. The header keeps the map's width.
          obstacles.push({
            x: rect.left - origin.left - gap,
            y: rect.top - origin.top - gap,
            width: rect.width + gap * 2,
            height: rect.height + gap * 2,
          });
        }
      }
      const frame = {
        x: headerLeft - origin.left,
        y: top - origin.top,
        width: bounds.right - headerLeft,
        height: Math.min(bottom, headerBottom) - top,
      };
      const next = {
        bounds: frame,
        footer: {
          bounds: {
            ...frame,
            x: bounds.left - origin.left,
            width: bounds.width,
            height: Math.min(bottom, footerBottom) - top,
          },
          obstacles,
        },
      };
      const sameRect = (a: LevelRect, b: LevelRect) =>
        a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
      setSafe((current) =>
        current &&
        sameRect(current.bounds, next.bounds) &&
        sameRect(current.footer.bounds, next.footer.bounds) &&
        current.footer.obstacles.length === obstacles.length &&
        current.footer.obstacles.every((rect, index) => sameRect(rect, obstacles[index]))
          ? current
          : next,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    const observeObstacles = () => {
      observer.disconnect();
      observer.observe(element);
      for (const obstacle of surface.querySelectorAll<HTMLElement>(obstacleSelector))
        observer.observe(obstacle);
      measure();
    };
    observeObstacles();
    // The overview toggle mounts a new minimap; measuring and selecting a
    // folded map also insert overlays after this component has mounted.
    const mutations = new MutationObserver(observeObstacles);
    mutations.observe(surface, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, [chrome.map.id, measuring]);

  const map = controller.nodes.find(
    (node): node is PlaceMapFlowNode => node.id === chrome.map.id && node.type === "placeMap",
  );
  const layout =
    map && safe
      ? projectMapChrome(
          {
            ...map.position,
            width: map.width ?? 0,
            height: map.height ?? 0,
          },
          viewport,
          safe.bounds,
          size?.mapId === chrome.map.id ? size : undefined,
          safe.footer,
        )
      : undefined;
  layoutWidth.current = layout?.width ?? 0;
  const visualClip =
    map && layout
      ? projectMapVisualClip(
          chrome.map.id,
          { ...map.position, width: map.width ?? 0, height: map.height ?? 0 },
          viewport,
          layout,
        )
      : undefined;
  const clipMapId = visualClip?.mapId;
  const clipTop = visualClip?.top;
  const clipRight = visualClip?.right;
  const clipBottom = visualClip?.bottom;
  const clipLeft = visualClip?.left;
  const clipBoundsX = visualClip?.bounds.x;
  const clipBoundsY = visualClip?.bounds.y;
  const clipBoundsWidth = visualClip?.bounds.width;
  const clipBoundsHeight = visualClip?.bounds.height;
  useLayoutEffect(() => {
    if (
      clipMapId === undefined ||
      clipTop === undefined ||
      clipRight === undefined ||
      clipBottom === undefined ||
      clipLeft === undefined ||
      clipBoundsX === undefined ||
      clipBoundsY === undefined ||
      clipBoundsWidth === undefined ||
      clipBoundsHeight === undefined
    ) {
      setVisualClip((current) => (current?.mapId === chrome.map.id ? undefined : current));
      return;
    }
    const next = {
      mapId: clipMapId,
      bounds: {
        x: clipBoundsX,
        y: clipBoundsY,
        width: clipBoundsWidth,
        height: clipBoundsHeight,
      },
      top: clipTop,
      right: clipRight,
      bottom: clipBottom,
      left: clipLeft,
    };
    setVisualClip((current) =>
      current &&
      current.mapId === next.mapId &&
      current.top === next.top &&
      current.right === next.right &&
      current.bottom === next.bottom &&
      current.left === next.left &&
      current.bounds.x === next.bounds.x &&
      current.bounds.y === next.bounds.y &&
      current.bounds.width === next.bounds.width &&
      current.bounds.height === next.bounds.height
        ? current
        : next,
    );
    return () => setVisualClip((current) => (current?.mapId === next.mapId ? undefined : current));
  }, [
    chrome.map.id,
    clipBottom,
    clipBoundsHeight,
    clipBoundsWidth,
    clipBoundsX,
    clipBoundsY,
    clipLeft,
    clipMapId,
    clipRight,
    clipTop,
    setVisualClip,
  ]);
  return (
    <>
      <div ref={boundary} className="place-map-chrome-boundary" aria-hidden="true" />
      {layout ? (
        <PlaceMapChrome
          {...chrome}
          layout={layout}
          zoom={viewport.zoom}
          onSize={onSize}
          crop={map?.type === "placeMap" ? map.data.crop : chrome.crop}
        />
      ) : null}
    </>
  );
}
