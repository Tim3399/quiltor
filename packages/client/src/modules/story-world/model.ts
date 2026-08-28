import type { NoteReference } from "../../shared";

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
  [key: string]: unknown;
}

export interface FigureEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  style?: "solid" | "dashed" | "blood" | "gold";
  gerichtet?: boolean;
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
  style?: "solid" | "dashed" | "blood" | "gold";
  gerichtet?: boolean;
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
  mapScale?: { unitsPer100px: number; unitLabel: string };
  timeSystem?: TimeSystem;
  [key: string]: unknown;
}

export interface WorldInfo {
  id: string;
  title: string;
  backupUrl: string;
  updated: string;
}
