import type { Node, NodeProps } from "@xyflow/react";
import { plateRuling } from "./PlaceMapNode";
import "./PlacePlate.css";
import "./PlaceGround.css";

export type PlaceGroundData = {
  source: string;
  title: string;
  /** The grid drawn over the picture, in flow units. */
  gridSize: number;
  /** Whether that grid is drawn at all. */
  gridVisible: boolean;
  /** What the canvas is magnified by, so the neatline holds its width. */
  zoom: number;
};

export type PlaceGroundNode = Node<PlaceGroundData>;

/**
 * The picture the open level stands on.
 *
 * Entering a map should land you on that map, not on the empty grid it happens
 * to be filed under, so what a level carries becomes the ground under it.
 *
 * The grid is drawn here rather than left to the canvas behind: React Flow's
 * background sits under every node, so a picture drawn as a node would bury it.
 * Drawn over the picture in the same flow units, it lines up with the canvas
 * grid beyond the picture's edges and keeps scaling with the viewport.
 */
export function PlaceGround({ data }: NodeProps<PlaceGroundNode>) {
  return (
    <div
      className="place-ground"
      style={
        {
          "--place-plate-grid": `${data.gridSize}px`,
          ...plateRuling(data.zoom),
        } as React.CSSProperties
      }
    >
      {data.source ? <img src={data.source} alt={data.title} draggable={false} /> : null}
      {data.gridVisible ? <span className="place-plate__grid" aria-hidden="true" /> : null}
      <span className="place-plate__rule" aria-hidden="true">
        <span className="place-plate__stud" />
        <span className="place-plate__stud" />
        <span className="place-plate__stud" />
        <span className="place-plate__stud" />
      </span>
    </div>
  );
}
