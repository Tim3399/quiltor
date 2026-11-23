import { useState } from "react";

type ArrangementProps = {
  nodesDraggable?: boolean;
  nodesConnectable?: boolean;
  elementsSelectable?: boolean;
};

/**
 * Whether a React Flow surface may be rearranged, held by the surface itself.
 *
 * React Flow's own padlock writes to its store, but its node renderer reads
 * `nodesDraggable` from the props it was rendered with, so a closed padlock took
 * away selecting and connecting and left dragging as it was. Holding the state
 * in the component and handing the three props down is what makes the button
 * mean something. Zooming and panning are deliberately not part of it.
 *
 * Every surface that shows the dock's arrangement lock takes its state and its
 * props from here, so there is one way to lock a surface and not one per canvas.
 */
export function useArrangementLock() {
  const [interactive, setInteractive] = useState(true);
  const arrangementProps = (base: ArrangementProps = {}) => ({
    nodesDraggable: interactive && (base.nodesDraggable ?? true),
    nodesConnectable: interactive && (base.nodesConnectable ?? true),
    elementsSelectable: interactive && (base.elementsSelectable ?? true),
  });
  return { interactive, setInteractive, arrangementProps };
}
