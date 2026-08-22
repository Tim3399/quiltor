import "./StoryGraph.css";

export type { FigureWorkspaceProps } from "./figures/FigureWorkspace";
export { kindLabel } from "./figures/relationships";
export type {
  CalendarMonth,
  CalendarWeekday,
  EntityAlias,
  FigureEdge,
  FigureKind,
  FigureNode,
  FigureState,
  PresenceEntry,
  Profile,
  ProfileExtra,
  RelationshipVersion,
  TimelineMoment,
  TimeSystem,
  TimeSystemKind,
  TimeSystemUnit,
  WorldInfo,
} from "./model";
export type { PlacesWorkspaceProps } from "./places/PlacesWorkspace";
export { canonicalTimelineOrder, insertTimelineMoment } from "./timeline/order";
export { normalizeTimeSystem } from "./timeline/timeSystem";
export { momentBoundaryTimeLabel, momentTimeLabel } from "./timeline/timelinePresentation";
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
