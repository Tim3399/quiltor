export type {
  StoryboardBoard,
  StoryboardBoardNode,
  StoryboardBoardTarget,
  StoryboardEdge,
  StoryboardGroupNode,
  StoryboardNode,
  StoryboardNodeKind,
  StoryboardNoteNode,
  StoryboardReferenceNode,
  StoryboardReferenceTarget,
  StoryboardState,
} from "./model";
export {
  createDefaultStoryboardState,
  DEFAULT_STORYBOARD_ID,
  DEFAULT_STORYBOARD_TITLE,
} from "./model";
export type { StoryboardWorkspaceProps } from "./StoryboardWorkspace";
export { STORYBOARD_REFERENCE_DRAG_MIME } from "./storyboardCanvasModel";

export const loadStoryboardWorkspace = () =>
  import("./StoryboardWorkspace").then(({ StoryboardWorkspace }) => ({
    default: StoryboardWorkspace,
  }));
