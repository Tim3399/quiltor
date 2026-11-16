/**
 * The stacking order of story nodes (T-129, D-73 R1):
 * selected > hover/focus > favourite > ordinary.
 *
 * React Flow adds 1000 to a selected node by itself (`elevateNodesOnSelect`), so a selected
 * node already sits above everything spelled out here. Hover and focus are lifted in
 * StoryGraph.css, because the wrapper's inline `z-index` is the only thing that reaches the
 * wrapper and a pointer state cannot be written into node data without a re-render per move.
 *
 * Both numbers stay below the journey and presence edges (5): the line over a favourite is
 * what it has always been, and the helper nodes of the place map (-1, -2) stay underneath.
 */
const STORY_NODE_Z_ORDINARY = 0;
const STORY_NODE_Z_FAVOURITE = 4;

export function storyNodeZIndex(favourite: boolean | undefined): number {
  return favourite ? STORY_NODE_Z_FAVOURITE : STORY_NODE_Z_ORDINARY;
}
