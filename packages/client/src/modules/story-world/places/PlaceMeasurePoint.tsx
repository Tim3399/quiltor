import { Handle, Position } from "@xyflow/react";
import type { CSSProperties } from "react";
import "./PlaceMeasurePoint.css";

/** Both handles sit in the node's middle, which is the point that was clicked. */
const anchorStyle = {
  top: "50%",
  right: "auto",
  bottom: "auto",
  left: "50%",
  transform: "translate(-50%, -50%)",
} satisfies CSSProperties;

/**
 * A free point the author set while measuring.
 *
 * Only a marker and an anchor for the measuring line: it is not a place, is never
 * stored, and nothing can pick it up. The node is centred on that point, so its
 * middle is exactly where a distance is taken from.
 */
export function PlaceMeasurePoint() {
  return (
    <div className="place-measure-point" aria-hidden="true">
      <span className="place-measure-point__dot" />
      <Handle
        id="place-anchor"
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="place-coordinate-handle"
        style={anchorStyle}
      />
      <Handle
        id="place-anchor"
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="place-coordinate-handle"
        style={anchorStyle}
      />
    </div>
  );
}
