import type {
  GraphEdgeColor,
  GraphEdgeLineStyle,
  GraphRelationshipKind,
  NoteMark,
  NoteReference,
} from "../../shared";

export interface ProfileExtra {
  k: string;
  v: string;
  [key: string]: unknown;
}

export interface ProfileField {
  id: string;
  key: string;
  value: string;
  [key: string]: unknown;
}

export interface Profile {
  fields?: ProfileField[];
  /** @deprecated Legacy fixed fields remain readable until every persisted world is migrated. */
  alter?: string;
  /** @deprecated Use fields. */
  rolle?: string;
  /** @deprecated Use fields. */
  aussehen?: string;
  /** @deprecated Use fields. */
  herkunft?: string;
  /** @deprecated Use fields. */
  stimme?: string;
  notizen?: string;
  noteReferences?: NoteReference[];
  noteMarks?: NoteMark[];
  /** @deprecated Legacy custom fields remain readable until every persisted world is migrated. */
  extra?: ProfileExtra[];
  [key: string]: unknown;
}

export type FigureKind = "person" | "tier" | "ort" | "organisation" | "objekt" | "konzept";

export interface EntityAlias {
  alias: string;
  source?: "manual" | "manuscript" | "assistant" | "import";
  [key: string]: unknown;
}

export interface MapScale {
  unitsPer100px: number;
  unitLabel: string;
}

export interface FigureNode {
  id: string;
  x: number;
  y: number;
  type?: FigureKind;
  label?: string;
  name: string;
  sub?: string;
  accent?: "ink" | "gold" | "rose" | "moss";
  dash?: boolean;
  pinned?: boolean;
  important?: boolean;
  diedMomentId?: string;
  profile?: Profile;
  aliases?: EntityAlias[];
  mapX?: number;
  mapY?: number;
  /**
   * Every place is also a level: opening one shows the surface inside it. These
   * describe where a place sits on its parent level and how it is drawn there.
   * All of them are optional, and a world that uses none behaves exactly as it
   * did before: one root level, nothing expanded, no picture anywhere.
   */
  parentPlaceId?: string;
  /** Position on the parent level, normalised so a resize carries it along. */
  mapU?: number;
  mapV?: number;
  /** Drawn as an area on the parent level rather than as a card. */
  mapExpanded?: boolean;
  mapWidth?: number;
  mapHeight?: number;
  /** Optional backdrop for this place's own level. */
  mapImageId?: string;
  /**
   * How the picture sits inside its frame: enlarged by `mapImageZoom` around the
   * point `mapImageU`/`mapImageV`. One and centred shows the whole sheet.
   *
   * The same point decides which part of the map a collapsed card wears, so
   * choosing the telling detail once serves both views.
   */
  mapImageZoom?: number;
  mapImageU?: number;
  mapImageV?: number;
  /** What a distance measured inside this place means. */
  mapScale?: MapScale;
  [key: string]: unknown;
}

export interface FigureEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  lineStyle?: GraphEdgeLineStyle;
  relationshipKind?: GraphRelationshipKind;
  /** @deprecated Use lineStyle, relationshipKind and color independently. */
  style?: "solid" | "dashed" | "blood" | "gold";
  gerichtet?: boolean;
  color?: GraphEdgeColor;
  fromHandle?: string;
  toHandle?: string;
  active?: boolean;
  versions?: RelationshipVersion[];
  [key: string]: unknown;
}

export interface RelationshipVersion {
  momentId: string;
  from?: string;
  to?: string;
  label?: string;
  lineStyle?: GraphEdgeLineStyle;
  relationshipKind?: GraphRelationshipKind;
  /** @deprecated Use lineStyle, relationshipKind and color independently. */
  style?: "solid" | "dashed" | "blood" | "gold";
  gerichtet?: boolean;
  color?: GraphEdgeColor;
  active: boolean;
}

export interface TimelineMoment {
  id: string;
  title: string;
  time?: number;
  position?: number;
  precision?: "day" | "month" | "year";
  endTime?: number;
  endPrecision?: "day" | "month" | "year";
  date?: string;
  note?: string;
  noteReferences?: NoteReference[];
  noteMarks?: NoteMark[];
}

export type TimeSystemKind = "relative" | "gregorian" | "custom";
export type TimeSystemUnit = "day" | "abstract";

export interface CalendarMonth {
  name: string;
  shortName: string;
  dayCount: number;
  [key: string]: unknown;
}

export interface CalendarWeekday {
  name: string;
  shortName: string;
  [key: string]: unknown;
}

export interface TimeSystem {
  id: string;
  name: string;
  kind: TimeSystemKind;
  unit: TimeSystemUnit;
  eraName: string;
  eraAbbreviation: string;
  epochTime: number;
  epochYear: number;
  epochMonth: number;
  epochDay: number;
  epochWeekday: number;
  displayFormat: string;
  months: CalendarMonth[];
  weekdays: CalendarWeekday[];
  [key: string]: unknown;
}

export interface PresenceEntry {
  id: string;
  elementId: string;
  placeId: string;
  momentId?: string;
}

export interface FigureState {
  nodes: FigureNode[];
  edges: FigureEdge[];
  timeline?: TimelineMoment[];
  presence?: PresenceEntry[];
  canvasSize?: { w: number; h: number };
  mapScale?: MapScale;
  timeSystem?: TimeSystem;
  [key: string]: unknown;
}

export interface WorldInfo {
  id: string;
  title: string;
  backupUrl: string;
  updated: string;
}
