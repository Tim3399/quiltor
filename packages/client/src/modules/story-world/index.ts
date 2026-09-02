import "./StoryGraph.css";

export type { FigureWorkspaceProps } from "./figures/FigureWorkspace";
export { authoredFigureLabel, figureDisplayLabel } from "./figures/figureLabel";
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
  ProfileField,
  RelationshipVersion,
  TimelineMoment,
  TimeSystem,
  TimeSystemKind,
  TimeSystemUnit,
  WorldInfo,
} from "./model";
export type { PlacesWorkspaceProps } from "./places/PlacesWorkspace";
export {
  LEGACY_PROFILE_FIELD_KEYS,
  LEGACY_PROFILE_FIELD_LABELS,
  type LegacyProfileFieldKey,
  type LegacyProfileFieldLabel,
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
