import { type Node, type NodeProps, NodeResizer } from "@xyflow/react";
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useRef } from "react";
import type { FigureNode } from "../model";
import { type ImageCrop, movedCrop, zoomedCrop } from "./placeImageCrop";
import "./PlacePlate.css";
import "./PlaceMapNode.css";

export type PlaceMapNodeData = {
  place: FigureNode;
  /** This sheet's top-left corner on the level, in flow units. */
  origin: { x: number; y: number };
  source: string;
  /** How the picture sits in the frame right now, draft included. */
  crop: ImageCrop;
  /** Whether this map's picture is the one being adjusted. */
  adjusting: boolean;
  onResize: (place: FigureNode, size: { width: number; height: number }) => void;
  onResizeLive: (place: FigureNode, size: { width: number; height: number }) => void;
  onCropDraft: (place: FigureNode, crop: ImageCrop) => void;
  onCropCommit: (place: FigureNode, crop: ImageCrop) => void;
  /** What the picture turned out to be, once the browser has it. */
  onPictureSize: (place: FigureNode, size: { width: number; height: number }) => void;
  /** The grid drawn over the picture, in flow units. */
  gridSize: number;
  /** What the canvas is magnified by, so grips can hold their size on screen. */
  zoom: number;
};

export type PlaceMapFlowNode = Node<PlaceMapNodeData>;

/**
 * A map laid out on the surface: the same place as the card, opened out.
 *
 * It rides in the flow as a node so it pans, zooms and drags with everything
 * standing on it. Collapsing turns it back into a card without changing what it
 * is -- only how much room it takes.
 *
 * There is no way in from here, deliberately: laid out, the map already shows
 * what is inside it. Going in is what a collapsed card offers, and offering both
 * would be two doors into the same room.
 *
 * It carries no buttons either. A map is drawn at the size of the ground it
 * stands for, so anything pinned to its edge is off the screen exactly when the
 * map is big enough to be worth using. The controls live beside the canvas
 * instead; what stays here is the one gesture that has to happen on the picture,
 * which is dragging it around inside its frame.
 */
export function PlaceMapNode({ data, selected }: NodeProps<PlaceMapFlowNode>) {
  const place = data.place;
  const crop = data.crop;
  const dragFrom = useRef<{ x: number; y: number; crop: ImageCrop } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!data.adjusting) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragFrom.current = { x: event.clientX, y: event.clientY, crop };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const from = dragFrom.current;
    if (!from) return;
    const box = event.currentTarget.getBoundingClientRect();
    data.onCropDraft(
      place,
      movedCrop(from.crop, {
        x: (event.clientX - from.x) / Math.max(1, box.width),
        y: (event.clientY - from.y) / Math.max(1, box.height),
      }),
    );
  };

  const onPointerUp = () => {
    if (!dragFrom.current) return;
    dragFrom.current = null;
    data.onCropCommit(place, crop);
  };

  return (
    <figure
      className={`place-map-node ${selected ? "is-selected" : ""} ${
        data.adjusting ? "is-adjusting" : ""
      }`}
      style={
        {
          "--place-plate-grid": `${data.gridSize}px`,
          // The canvas rules its lines from the level's origin. Shifting the
          // sheet's own pattern by where the sheet starts is what makes the two
          // one ruling rather than two that happen to share a spacing.
          "--place-plate-grid-x": `${-mod(data.origin.x, data.gridSize)}px`,
          "--place-plate-grid-y": `${-mod(data.origin.y, data.gridSize)}px`,
          // Everything inside a node is drawn in flow units and magnified with
          // the canvas, which is right for a picture and wrong for something to
          // take hold of: it leaves a grip a few pixels wide on a map drawn
          // small, and pushes the corners off the screen on one drawn large.
          // Dividing by the magnification gives a grip the same size on screen
          // at every zoom, and puts one along every edge so a corner is never
          // the only thing to aim at.
          "--place-map-grip": `${GRIP_SCREEN_PX / Math.max(0.02, data.zoom)}px`,
          // The neatline is a drawing convention, not part of the terrain: it
          // says where the sheet ends, and it has to say so just as clearly on a
          // map filling the screen as on one seen whole from far out. So its
          // margin and its hairlines are measured on screen too, while the ticks
          // crossing them keep the ruling's own spacing in world units.
          ...plateRuling(data.zoom),
        } as CSSProperties
      }
    >
      {/* Resizing a map is how its scale is declared: making it wider says the
          same picture covers more ground. Kept to the picture's own proportions,
          so the frame can never show paper the picture does not cover. The places
          standing on it are held as fractions, so they travel with the change. */}
      <NodeResizer
        isVisible={selected && !data.adjusting}
        keepAspectRatio
        minWidth={120}
        minHeight={80}
        handleClassName="place-map-node__handle"
        lineClassName="place-map-node__line"
        onResize={(_, size) => data.onResizeLive(place, { width: size.width, height: size.height })}
        onResizeEnd={(_, size) => data.onResize(place, { width: size.width, height: size.height })}
      />
      <span className="place-plate__rule" aria-hidden="true">
        <span className="place-plate__stud" />
        <span className="place-plate__stud" />
        <span className="place-plate__stud" />
        <span className="place-plate__stud" />
      </span>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: this is a surface
          being dragged, not a control; every adjustment it makes is also
          reachable from the buttons beside the canvas. */}
      <div
        className={`place-map-node__frame ${data.adjusting ? "nodrag nopan nowheel" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(event) => {
          if (!data.adjusting) return;
          event.stopPropagation();
          data.onCropCommit(place, zoomedCrop(crop, event.deltaY < 0 ? 1 : -1));
        }}
      >
        <img
          src={data.source}
          alt={place.name}
          draggable={false}
          onLoad={(event) =>
            data.onPictureSize(place, {
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
          style={{
            transform: `scale(${crop.zoom})`,
            transformOrigin: `${crop.u * 100}% ${crop.v * 100}%`,
          }}
        />
      </div>
      <span className="place-plate__grid" aria-hidden="true" />
    </figure>
  );
}

/** How wide a grip should be on screen, whatever the canvas is magnified by. */
const GRIP_SCREEN_PX = 18;

/** How wide the neatline's margin should be on screen, and its rules. */
const BAND_SCREEN_PX = 10;
const HAIRLINE_SCREEN_PX = 1;

/** The plate's own measures, held at a constant size on screen. */
export function plateRuling(zoom: number): CSSProperties {
  const magnification = Math.max(0.02, zoom);
  return {
    "--place-plate-band": `${BAND_SCREEN_PX / magnification}px`,
    "--place-plate-hair": `${HAIRLINE_SCREEN_PX / magnification}px`,
  } as CSSProperties;
}

/** A modulo that stays positive, which the remainder operator does not. */
function mod(value: number, size: number): number {
  if (!(size > 0) || !Number.isFinite(value)) return 0;
  return ((value % size) + size) % size;
}
