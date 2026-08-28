import type { FigureState } from "../../../modules/story-world";
import { ENTITY_ALIAS_NORMALIZATION_V1, normalizeEntityAliasV1 } from "../../../shared";
import {
  type DecodedDocumentV1,
  type DocumentEnvelopeWireV1,
  decodeDocumentEnvelopeV1,
  encodeDocumentEnvelopeV1,
} from "./documentEnvelope";
import {
  cloneNoteReferences,
  type NoteReferenceWireV1,
  validateNoteReferences,
} from "./noteReference";
import {
  optional,
  WireContractError,
  type WireRecord,
  wireArray,
  wireBoolean,
  wireEnum,
  wireInteger,
  wireNumber,
  wireRecord,
  wireString,
} from "./validation";

export interface EntityAliasWireV1 {
  alias: string;
  source?: "manual" | "manuscript" | "assistant" | "import";
  [key: string]: unknown;
}

export interface ProfileWireV1 {
  alter?: string;
  rolle?: string;
  aussehen?: string;
  herkunft?: string;
  stimme?: string;
  notizen?: string;
  noteReferences?: NoteReferenceWireV1[];
  extra?: Array<{ k: string; v: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface FigureNodeWireV1 {
  id: string;
  name: string;
  x: number;
  y: number;
  type?: "person" | "tier" | "ort" | "organisation" | "objekt" | "konzept";
  label?: string;
  sub?: string;
  accent?: "ink" | "gold" | "rose" | "moss";
  dash?: boolean;
  pinned?: boolean;
  important?: boolean;
  diedMomentId?: string;
  mapX?: number;
  mapY?: number;
  profile?: ProfileWireV1;
  aliases?: EntityAliasWireV1[];
  [key: string]: unknown;
}

export interface RelationshipVersionWireV1 {
  momentId: string;
  from?: string;
  to?: string;
  label?: string;
  style?: "solid" | "dashed" | "blood" | "gold";
  gerichtet?: boolean;
  active: boolean;
  [key: string]: unknown;
}

export interface FigureEdgeWireV1 {
  id: string;
  from: string;
  to: string;
  label?: string;
  style?: "solid" | "dashed" | "blood" | "gold";
  gerichtet?: boolean;
  fromHandle?: string;
  toHandle?: string;
  active?: boolean;
  versions?: RelationshipVersionWireV1[];
  [key: string]: unknown;
}

export interface TimelineMomentWireV1 {
  id: string;
  title?: string;
  time?: number;
  position?: number;
  precision?: "day" | "month" | "year";
  endTime?: number;
  endPrecision?: "day" | "month" | "year";
  date?: string;
  note?: string;
  noteReferences?: NoteReferenceWireV1[];
  [key: string]: unknown;
}

export interface PresenceEntryWireV1 {
  id: string;
  elementId: string;
  placeId: string;
  momentId?: string;
  [key: string]: unknown;
}

export interface CalendarMonthWireV1 {
  name: string;
  shortName?: string;
  dayCount: number;
  [key: string]: unknown;
}

export interface CalendarWeekdayWireV1 {
  name: string;
  shortName?: string;
  [key: string]: unknown;
}

export interface TimeSystemWireV1 {
  id: string;
  name: string;
  kind: "relative" | "gregorian" | "custom";
  unit?: "day" | "abstract";
  eraName?: string;
  eraAbbreviation?: string;
  epochTime?: number;
  epochYear?: number;
  epochMonth?: number;
  epochDay?: number;
  epochWeekday?: number;
  displayFormat?: string;
  months?: CalendarMonthWireV1[];
  weekdays?: CalendarWeekdayWireV1[];
  [key: string]: unknown;
}

export interface StoryWorldPayloadWireV1 {
  nodes: FigureNodeWireV1[];
  edges: FigureEdgeWireV1[];
  timeline?: TimelineMomentWireV1[];
  presence?: PresenceEntryWireV1[];
  canvasSize?: { w: number; h: number; [key: string]: unknown };
  mapScale?: { unitsPer100px: number; unitLabel: string; [key: string]: unknown };
  timeSystem?: TimeSystemWireV1;
  [key: string]: unknown;
}

export type StoryWorldWireV1 = DocumentEnvelopeWireV1<StoryWorldPayloadWireV1>;

const FIGURE_KINDS = ["person", "tier", "ort", "organisation", "objekt", "konzept"] as const;
const ACCENTS = ["ink", "gold", "rose", "moss"] as const;
const EDGE_STYLES = ["solid", "dashed", "blood", "gold"] as const;

export { ENTITY_ALIAS_NORMALIZATION_V1, normalizeEntityAliasV1 };

const PRECISIONS = ["day", "month", "year"] as const;

function optionalString(record: WireRecord, key: string, path: string): void {
  optional(record, key, wireString, path);
}

function optionalBoolean(record: WireRecord, key: string, path: string): void {
  optional(record, key, wireBoolean, path);
}

function validateProfile(value: unknown, path: string): void {
  const profile = wireRecord(value, path);
  for (const key of ["alter", "rolle", "aussehen", "herkunft", "stimme", "notizen"]) {
    optionalString(profile, key, path);
  }
  if (profile.noteReferences !== undefined) {
    validateNoteReferences(
      profile.noteReferences,
      typeof profile.notizen === "string" ? profile.notizen : "",
      `${path}.noteReferences`,
    );
  }
  if (profile.extra !== undefined) {
    for (const [index, extraValue] of wireArray(profile.extra, `${path}.extra`).entries()) {
      const itemPath = `${path}.extra[${index}]`;
      const extra = wireRecord(extraValue, itemPath);
      wireString(extra.k, `${itemPath}.k`);
      wireString(extra.v, `${itemPath}.v`);
    }
  }
}

function validateNode(value: unknown, path: string): FigureNodeWireV1 {
  const node = wireRecord(value, path);
  wireString(node.id, `${path}.id`, { min: 1 });
  wireString(node.name, `${path}.name`);
  wireNumber(node.x, `${path}.x`);
  wireNumber(node.y, `${path}.y`);
  optional(node, "type", (item, itemPath) => wireEnum(item, FIGURE_KINDS, itemPath), path);
  optional(node, "accent", (item, itemPath) => wireEnum(item, ACCENTS, itemPath), path);
  for (const key of ["label", "sub"]) optionalString(node, key, path);
  optional(node, "diedMomentId", (item, itemPath) => wireString(item, itemPath, { min: 1 }), path);
  for (const key of ["dash", "pinned", "important"]) optionalBoolean(node, key, path);
  optional(node, "mapX", wireNumber, path);
  optional(node, "mapY", wireNumber, path);
  optional(node, "profile", validateProfile, path);
  if (node.aliases !== undefined) {
    const aliases = new Set<string>();
    for (const [index, aliasValue] of wireArray(node.aliases, `${path}.aliases`).entries()) {
      const aliasPath = `${path}.aliases[${index}]`;
      const alias = wireRecord(aliasValue, aliasPath);
      const name = wireString(alias.alias, `${aliasPath}.alias`, { min: 1 });
      const normalizedName = normalizeEntityAliasV1(name);
      if (!normalizedName || aliases.has(normalizedName)) {
        throw new WireContractError(aliasPath);
      }
      aliases.add(normalizedName);
      optional(
        alias,
        "source",
        (item, itemPath) =>
          wireEnum(item, ["manual", "manuscript", "assistant", "import"] as const, itemPath),
        aliasPath,
      );
    }
  }
  return node as unknown as FigureNodeWireV1;
}

function validateTimeline(value: unknown, path: string): TimelineMomentWireV1[] {
  const moments = wireArray(value, path);
  const ids = new Set<string>();
  return moments.map((momentValue, index) => {
    const momentPath = `${path}[${index}]`;
    const moment = wireRecord(momentValue, momentPath);
    const id = wireString(moment.id, `${momentPath}.id`, { min: 1 });
    if (ids.has(id)) throw new WireContractError(`${momentPath}.id`);
    ids.add(id);
    optionalString(moment, "title", momentPath);
    optionalString(moment, "date", momentPath);
    optionalString(moment, "note", momentPath);
    if (moment.noteReferences !== undefined) {
      validateNoteReferences(
        moment.noteReferences,
        typeof moment.note === "string" ? moment.note : "",
        `${momentPath}.noteReferences`,
      );
    }
    optional(moment, "time", wireInteger, momentPath);
    optional(moment, "position", wireInteger, momentPath);
    optional(
      moment,
      "precision",
      (item, itemPath) => wireEnum(item, PRECISIONS, itemPath),
      momentPath,
    );
    optional(moment, "endTime", wireInteger, momentPath);
    optional(
      moment,
      "endPrecision",
      (item, itemPath) => wireEnum(item, PRECISIONS, itemPath),
      momentPath,
    );
    if (
      typeof moment.endTime === "number" &&
      typeof moment.time === "number" &&
      moment.endTime < moment.time
    ) {
      throw new WireContractError(`${momentPath}.endTime`);
    }
    if (moment.endPrecision !== undefined && moment.endTime === undefined) {
      throw new WireContractError(`${momentPath}.endPrecision`);
    }
    return moment as unknown as TimelineMomentWireV1;
  });
}

function validateTimeSystem(value: unknown, path: string): TimeSystemWireV1 {
  const system = wireRecord(value, path);
  wireString(system.id, `${path}.id`, { min: 1 });
  wireString(system.name, `${path}.name`);
  const kind = wireEnum(system.kind, ["relative", "gregorian", "custom"] as const, `${path}.kind`);
  optional(
    system,
    "unit",
    (item, itemPath) => wireEnum(item, ["day", "abstract"] as const, itemPath),
    path,
  );
  if (kind !== "relative" && system.unit === "abstract") {
    throw new WireContractError(`${path}.unit`);
  }
  for (const key of ["eraName", "eraAbbreviation", "displayFormat"])
    optionalString(system, key, path);
  for (const key of ["epochTime", "epochYear", "epochMonth", "epochDay", "epochWeekday"]) {
    optional(system, key, wireInteger, path);
  }
  const months =
    system.months === undefined
      ? []
      : wireArray(system.months, `${path}.months`).map((monthValue, index) => {
          const monthPath = `${path}.months[${index}]`;
          const month = wireRecord(monthValue, monthPath);
          wireString(month.name, `${monthPath}.name`);
          optionalString(month, "shortName", monthPath);
          wireInteger(month.dayCount, `${monthPath}.dayCount`, { min: 1 });
          return month;
        });
  const weekdays =
    system.weekdays === undefined
      ? []
      : wireArray(system.weekdays, `${path}.weekdays`).map((weekdayValue, index) => {
          const weekdayPath = `${path}.weekdays[${index}]`;
          const weekday = wireRecord(weekdayValue, weekdayPath);
          wireString(weekday.name, `${weekdayPath}.name`);
          optionalString(weekday, "shortName", weekdayPath);
          return weekday;
        });
  if (kind === "custom" && months.length === 0) throw new WireContractError(`${path}.months`);
  const epochWeekday = system.epochWeekday ?? 0;
  if (
    weekdays.length &&
    (typeof epochWeekday !== "number" || epochWeekday < 0 || epochWeekday >= weekdays.length)
  ) {
    throw new WireContractError(`${path}.epochWeekday`);
  }
  if (kind === "custom") {
    const epochMonth = system.epochMonth ?? 1;
    const epochDay = system.epochDay ?? 1;
    if (
      typeof epochMonth !== "number" ||
      epochMonth < 1 ||
      epochMonth > months.length ||
      typeof epochDay !== "number" ||
      epochDay < 1 ||
      epochDay > Number(months[epochMonth - 1]?.dayCount)
    ) {
      throw new WireContractError(`${path}.epochMonth/epochDay`);
    }
  } else if (kind === "gregorian") {
    const year =
      system.epochYear === undefined ? 1 : wireInteger(system.epochYear, `${path}.epochYear`);
    const month =
      system.epochMonth === undefined ? 1 : wireInteger(system.epochMonth, `${path}.epochMonth`);
    const day =
      system.epochDay === undefined ? 1 : wireInteger(system.epochDay, `${path}.epochDay`);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) {
      throw new WireContractError(`${path}.epochYear/epochMonth/epochDay`);
    }
  }
  return system as unknown as TimeSystemWireV1;
}

function storyWorldPayload(value: unknown, path: string): StoryWorldPayloadWireV1 {
  const payload = wireRecord(value, path);
  const nodeIds = new Set<string>();
  const nodeKinds = new Map<string, string>();
  const nodes = wireArray(payload.nodes, `${path}.nodes`).map((nodeValue, index) => {
    const node = validateNode(nodeValue, `${path}.nodes[${index}]`);
    if (nodeIds.has(node.id)) throw new WireContractError(`${path}.nodes[${index}].id`);
    nodeIds.add(node.id);
    nodeKinds.set(node.id, node.type ?? "person");
    return node;
  });
  const timeline =
    payload.timeline === undefined ? [] : validateTimeline(payload.timeline, `${path}.timeline`);
  const momentIds = new Set(timeline.map((moment) => moment.id));

  const edgeIds = new Set<string>();
  const edges = wireArray(payload.edges, `${path}.edges`).map((edgeValue, index) => {
    const edgePath = `${path}.edges[${index}]`;
    const edge = wireRecord(edgeValue, edgePath);
    const id = wireString(edge.id, `${edgePath}.id`, { min: 1 });
    if (edgeIds.has(id)) throw new WireContractError(`${edgePath}.id`);
    edgeIds.add(id);
    const from = wireString(edge.from, `${edgePath}.from`, { min: 1 });
    const to = wireString(edge.to, `${edgePath}.to`, { min: 1 });
    if (!nodeIds.has(from) || !nodeIds.has(to)) throw new WireContractError(edgePath);
    optionalString(edge, "label", edgePath);
    optional(edge, "style", (item, itemPath) => wireEnum(item, EDGE_STYLES, itemPath), edgePath);
    for (const key of ["fromHandle", "toHandle"]) optionalString(edge, key, edgePath);
    for (const key of ["gerichtet", "active"]) optionalBoolean(edge, key, edgePath);
    if (edge.versions !== undefined) {
      const versionMoments = new Set<string>();
      for (const [versionIndex, versionValue] of wireArray(
        edge.versions,
        `${edgePath}.versions`,
      ).entries()) {
        const versionPath = `${edgePath}.versions[${versionIndex}]`;
        const version = wireRecord(versionValue, versionPath);
        const momentId = wireString(version.momentId, `${versionPath}.momentId`, { min: 1 });
        if (!momentIds.has(momentId) || versionMoments.has(momentId)) {
          throw new WireContractError(`${versionPath}.momentId`);
        }
        versionMoments.add(momentId);
        for (const key of ["from", "to"]) {
          if (version[key] !== undefined) {
            const endpoint = wireString(version[key], `${versionPath}.${key}`, { min: 1 });
            if (!nodeIds.has(endpoint)) throw new WireContractError(`${versionPath}.${key}`);
          }
        }
        optionalString(version, "label", versionPath);
        optional(
          version,
          "style",
          (item, itemPath) => wireEnum(item, EDGE_STYLES, itemPath),
          versionPath,
        );
        optionalBoolean(version, "gerichtet", versionPath);
        wireBoolean(version.active, `${versionPath}.active`);
      }
    }
    return edge as unknown as FigureEdgeWireV1;
  });

  if (payload.presence !== undefined) {
    const presenceIds = new Set<string>();
    const logicalEntries = new Set<string>();
    for (const [index, entryValue] of wireArray(payload.presence, `${path}.presence`).entries()) {
      const entryPath = `${path}.presence[${index}]`;
      const entry = wireRecord(entryValue, entryPath);
      const id = wireString(entry.id, `${entryPath}.id`, { min: 1 });
      const elementId = wireString(entry.elementId, `${entryPath}.elementId`, { min: 1 });
      const placeId = wireString(entry.placeId, `${entryPath}.placeId`, { min: 1 });
      if (presenceIds.has(id) || !nodeIds.has(elementId) || nodeKinds.get(placeId) !== "ort") {
        throw new WireContractError(entryPath);
      }
      presenceIds.add(id);
      let momentId = "";
      if (entry.momentId !== undefined) {
        momentId = wireString(entry.momentId, `${entryPath}.momentId`, { min: 1 });
        if (!momentIds.has(momentId)) throw new WireContractError(`${entryPath}.momentId`);
      }
      const logical = `${elementId}\0${momentId}`;
      if (logicalEntries.has(logical)) throw new WireContractError(entryPath);
      logicalEntries.add(logical);
    }
  }
  for (const [index, node] of nodes.entries()) {
    if (node.diedMomentId !== undefined && !momentIds.has(node.diedMomentId)) {
      throw new WireContractError(`${path}.nodes[${index}].diedMomentId`);
    }
  }
  if (payload.canvasSize !== undefined) {
    const size = wireRecord(payload.canvasSize, `${path}.canvasSize`);
    wireNumber(size.w, `${path}.canvasSize.w`, { exclusiveMin: 0 });
    wireNumber(size.h, `${path}.canvasSize.h`, { exclusiveMin: 0 });
  }
  if (payload.mapScale !== undefined) {
    const scale = wireRecord(payload.mapScale, `${path}.mapScale`);
    wireNumber(scale.unitsPer100px, `${path}.mapScale.unitsPer100px`, { exclusiveMin: 0 });
    wireString(scale.unitLabel, `${path}.mapScale.unitLabel`);
  }
  optional(payload, "timeSystem", validateTimeSystem, path);
  void edges;
  return payload as unknown as StoryWorldPayloadWireV1;
}

function cloneNode(node: FigureNodeWireV1): FigureNodeWireV1 {
  const clone = { ...node };
  if (node.profile !== undefined) {
    clone.profile = { ...node.profile };
    clone.profile.noteReferences = cloneNoteReferences(node.profile.noteReferences);
    if (node.profile.extra !== undefined) {
      clone.profile.extra = node.profile.extra.map((extra) => ({ ...extra }));
    }
  }
  if (node.aliases !== undefined) clone.aliases = node.aliases.map((alias) => ({ ...alias }));
  return clone;
}

function cloneEdge(edge: FigureEdgeWireV1): FigureEdgeWireV1 {
  const clone = { ...edge };
  if (edge.versions !== undefined)
    clone.versions = edge.versions.map((version) => ({ ...version }));
  return clone;
}

function encodeNode(node: FigureState["nodes"][number]): FigureNodeWireV1 {
  return {
    ...node,
    profile: node.profile
      ? {
          ...node.profile,
          noteReferences: cloneNoteReferences(node.profile.noteReferences),
          extra: node.profile.extra?.map((extra) => ({ ...extra })),
        }
      : undefined,
    aliases: node.aliases?.map((alias) => ({ ...alias })),
  };
}

function encodeEdge(edge: FigureState["edges"][number]): FigureEdgeWireV1 {
  return {
    ...edge,
    versions: edge.versions?.map((version) => ({ ...version })),
  };
}

function cloneTimeSystem(system: TimeSystemWireV1) {
  return {
    ...system,
    unit: system.unit ?? "day",
    eraName: system.eraName ?? "",
    eraAbbreviation: system.eraAbbreviation ?? "",
    epochTime: system.epochTime ?? 0,
    epochYear: system.epochYear ?? 1,
    epochMonth: system.epochMonth ?? 1,
    epochDay: system.epochDay ?? 1,
    epochWeekday: system.epochWeekday ?? 0,
    displayFormat: system.displayFormat ?? "",
    months: (system.months ?? []).map((month) => ({
      ...month,
      shortName: month.shortName ?? "",
    })),
    weekdays: (system.weekdays ?? []).map((weekday) => ({
      ...weekday,
      shortName: weekday.shortName ?? "",
    })),
  };
}

export function decodeStoryWorldV1(value: unknown): DecodedDocumentV1<FigureState> {
  const wire = decodeDocumentEnvelopeV1(value, "quiltor.story-world", storyWorldPayload);
  const payload = wire.payload;
  return {
    document: {
      ...payload,
      nodes: payload.nodes.map(cloneNode),
      edges: payload.edges.map(cloneEdge),
      timeline: payload.timeline?.map((moment) => ({
        ...moment,
        title: moment.title ?? "",
        noteReferences: cloneNoteReferences(moment.noteReferences),
      })),
      presence: payload.presence?.map((entry) => ({ ...entry })),
      canvasSize: payload.canvasSize ? { ...payload.canvasSize } : undefined,
      mapScale: payload.mapScale ? { ...payload.mapScale } : undefined,
      timeSystem: payload.timeSystem ? cloneTimeSystem(payload.timeSystem) : undefined,
    },
    revision: wire.revision,
  };
}

export function encodeStoryWorldV1(model: FigureState, revision?: number): StoryWorldWireV1 {
  const payload = {
    ...model,
    nodes: model.nodes.map(encodeNode),
    edges: model.edges.map(encodeEdge),
    timeline: model.timeline?.map((moment) => ({
      ...moment,
      noteReferences: cloneNoteReferences(moment.noteReferences),
    })),
    presence: model.presence?.map((entry) => ({ ...entry })),
    canvasSize: model.canvasSize ? { ...model.canvasSize } : undefined,
    mapScale: model.mapScale ? { ...model.mapScale } : undefined,
    timeSystem: model.timeSystem
      ? {
          ...model.timeSystem,
          months: model.timeSystem.months.map((month) => ({ ...month })),
          weekdays: model.timeSystem.weekdays.map((weekday) => ({ ...weekday })),
        }
      : undefined,
  } as StoryWorldPayloadWireV1;
  return encodeDocumentEnvelopeV1("quiltor.story-world", payload, revision, storyWorldPayload);
}
