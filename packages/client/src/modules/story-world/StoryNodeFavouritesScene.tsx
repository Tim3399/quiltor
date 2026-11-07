import { Handle, type NodeProps, Position, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { Star } from "lucide-react";
import { useEffect } from "react";
import { GRAPH_CONNECTION_HANDLES } from "../graph";
import type { FigureFlowNode } from "./figures/FigureNode";
import { createFigureFlowNodes } from "./figures/figureCanvasModel";
import type { FigureNode } from "./model";
import { StoryNodeCard, StoryNodeIdentity } from "./StoryNodeCard";

/**
 * Overview scene for T-129: forty ordinary markers packed so tightly that they overlap, and
 * three favourites standing among them. The favourites come FIRST in the array on purpose --
 * without a z-index they would be drawn first and every later marker would cover them, which
 * is the defect this scene exists to catch.
 *
 * The nodes are the production mapping (`createFigureFlowNodes`); only the node renderer is
 * swapped for one without the i18n provider the gallery does not have.
 */
const ZOOM = 0.25;
const WIDTH = 720;
const HEIGHT = 420;

const FAVOURITES: readonly FigureNode[] = [
  { id: "fav-libelle", name: "Libelle", type: "ort", important: true, x: 1120, y: 700 },
  { id: "fav-hafen", name: "Hafenmeisterei", type: "ort", important: true, x: 1640, y: 780 },
  { id: "fav-mole", name: "Nördliche Mole", type: "ort", important: true, x: 1120, y: 940 },
];

const ORDINARY: readonly FigureNode[] = Array.from({ length: 40 }, (_, index) => ({
  id: `ort-${index}`,
  name: `Ort ${index + 1}`,
  type: index % 7 === 0 ? "person" : "ort",
  // A tight lattice with a deterministic wobble: nothing random, so a screenshot is stable.
  x: 1080 + (index % 8) * 90 + ((index * 37) % 23),
  y: 560 + Math.floor(index / 8) * 100 + ((index * 53) % 29),
}));

function SceneNode({ data }: NodeProps<FigureFlowNode>) {
  const item = data.figure;
  return (
    <StoryNodeCard
      zoomTier={data.zoomTier}
      viewportZoom={data.zoom}
      kind={item.type || "person"}
      important={!!item.important}
    >
      <Handle id={GRAPH_CONNECTION_HANDLES.incoming} type="target" position={Position.Left} />
      <StoryNodeIdentity
        kindLabel={item.type}
        name={item.name}
        leading={
          item.important ? <Star className="importance-mark" aria-hidden="true" /> : undefined
        }
      />
      <Handle id={GRAPH_CONNECTION_HANDLES.outgoing} type="source" position={Position.Right} />
    </StoryNodeCard>
  );
}

const nodeTypes = { story: SceneNode };

export function StoryNodeFavouritesScene({
  theme,
  circle,
}: {
  theme: "light" | "dark";
  circle: "star" | "empty";
}) {
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);
  // Favourites first: see the note above.
  const nodes = createFigureFlowNodes([...FAVOURITES, ...ORDINARY], "overview", ZOOM);
  return (
    <main
      className="design-story-page"
      data-design-scene="story-node-favourites"
      data-design-theme={theme}
      data-favourite-circle={circle}
    >
      <div
        className="story-node-favourites-scene"
        style={{ width: WIDTH, height: HEIGHT, position: "relative" }}
      >
        <ReactFlowProvider>
          <ReactFlow<FigureFlowNode>
            nodes={nodes}
            edges={[]}
            nodeTypes={nodeTypes}
            defaultViewport={{ x: 0, y: 10, zoom: ZOOM }}
            minZoom={ZOOM}
            maxZoom={ZOOM}
            nodesDraggable={false}
            nodesConnectable={false}
            panOnDrag={false}
            zoomOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
            proOptions={{ hideAttribution: true }}
          />
        </ReactFlowProvider>
      </div>
    </main>
  );
}
