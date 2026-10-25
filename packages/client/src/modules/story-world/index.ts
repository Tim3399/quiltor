import "./StoryGraph.css";

export { authoredFigureLabel } from "./figures/figureLabel";
export { kindLabel } from "./figures/relationships";
export type {
  FigureEdge,
  FigureKind,
  FigureNode,
  FigureState,
  Profile,
  ProfileField,
  TimelineMoment,
  TimeSystem,
  WorldInfo,
} from "./model";
export {
  LEGACY_PROFILE_FIELD_KEYS,
  normalizeProfile,
  normalizeProfileFields,
} from "./profile";
export { canonicalTimelineOrder, insertTimelineMoment } from "./timeline/order";
export { momentBoundaryTimeLabel, momentTimeLabel } from "./timeline/timelinePresentation";
export { normalizeTimeSystem } from "./timeline/timeSystem";
export { WorldGate } from "./worlds/WorldGate";

export const loadFigureWorkspace = () =>
  import("./figures/FigureWorkspace").then(({ FigureWorkspace }) => ({
    default: FigureWorkspace,
  }));

export const loadTimelineWorkspace = () =>
  import("./timeline/TimelineWorkspace").then(({ TimelineWorkspace }) => ({
    default: TimelineWorkspace,
  }));

export const loadPlacesWorkspace = () =>
  import("./places/PlacesWorkspace").then(({ PlacesWorkspace }) => ({
    default: PlacesWorkspace,
  }));
