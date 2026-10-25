export type {
  StoryboardBoard,
  StoryboardEdge,
  StoryboardNode,
  StoryboardState,
} from "./model";
export { createDefaultStoryboardState } from "./model";

export const loadStoryboardWorkspace = () =>
  import("./StoryboardWorkspace").then(({ StoryboardWorkspace }) => ({
    default: StoryboardWorkspace,
  }));
