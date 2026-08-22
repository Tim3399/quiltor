import type { FigureNode, PresenceEntry, TimelineMoment, TimeSystem } from "../model";
import { uid } from "../../../shared/id";
import { figureIsDeceased } from "./relationships";
import { formatDuration, momentDateDiffDays } from "./date";

export function momentIndex(timeline: TimelineMoment[], momentId?: string): number {
  if (!momentId) return -1;
  const index = timeline.findIndex((moment) => moment.id === momentId);
  return index >= 0 ? index : -2;
}

export function resolvePresence(
  elementId: string,
  presence: PresenceEntry[],
  timeline: TimelineMoment[],
  activeId: string | null,
): PresenceEntry | undefined {
  const activeIndex = activeId ? momentIndex(timeline, activeId) : -1;
  const eligible = presence
    .filter((entry) => entry.elementId === elementId)
    .map((entry) => ({ entry, index: momentIndex(timeline, entry.momentId) }))
    .filter((item) => item.index >= -1 && item.index <= activeIndex)
    .sort((a, b) => a.index - b.index);
  return eligible.at(-1)?.entry;
}

export function presenceFieldEditor(
  elementId: string,
  presence: PresenceEntry[],
  timeline: TimelineMoment[],
  activeId: string | null,
): { placeId: string; inheritedPlaceId?: string } {
  if (!activeId) {
    const base = presence.find((entry) => entry.elementId === elementId && !entry.momentId);
    return { placeId: base?.placeId ?? "" };
  }
  const own = presence.find(
    (entry) => entry.elementId === elementId && entry.momentId === activeId,
  );
  if (own) return { placeId: own.placeId };
  const index = momentIndex(timeline, activeId);
  const inherited = resolvePresence(
    elementId,
    presence,
    timeline,
    index > 0 ? timeline[index - 1].id : null,
  );
  return { placeId: "", inheritedPlaceId: inherited?.placeId };
}

export function patchPresence(
  presence: PresenceEntry[],
  elementId: string,
  momentId: string | null,
  placeId: string | null,
): PresenceEntry[] {
  const remaining = presence.filter(
    (entry) => !(entry.elementId === elementId && (entry.momentId ?? null) === momentId),
  );
  if (!placeId) return remaining;
  const entry: PresenceEntry = {
    id: uid("p"),
    elementId,
    placeId,
    ...(momentId ? { momentId } : {}),
  };
  return [...remaining, entry];
}

export interface JourneyStop {
  placeId: string;
  momentId?: string;
  index: number;
}

export function figureJourney(
  figure: FigureNode,
  presence: PresenceEntry[],
  timeline: TimelineMoment[],
): JourneyStop[] {
  const rawDeathIndex = figure.diedMomentId ? momentIndex(timeline, figure.diedMomentId) : Infinity;
  // A dangling diedMomentId (its moment was deleted) means we no longer know when this
  // figure died -- treat that as "not (yet) dead" rather than -2 sorting before every
  // real stop and silently emptying the whole journey.
  const deathIndex = rawDeathIndex === -2 ? Infinity : rawDeathIndex;
  const stops = presence
    .filter((entry) => entry.elementId === figure.id)
    .map((entry) => ({
      placeId: entry.placeId,
      momentId: entry.momentId,
      index: momentIndex(timeline, entry.momentId),
    }))
    .filter((stop) => stop.index >= -1 && stop.index <= deathIndex)
    .sort((a, b) => a.index - b.index);
  return stops.filter((stop, i) => i === 0 || stop.placeId !== stops[i - 1].placeId);
}

export interface JourneyLeg {
  from: JourneyStop;
  to: JourneyStop;
  walked: boolean;
  current: boolean;
}

export function journeyLegs(
  stops: JourneyStop[],
  timeline: TimelineMoment[],
  activeId: string | null,
): JourneyLeg[] {
  const activeIndex = activeId ? momentIndex(timeline, activeId) : -1;
  const legs: JourneyLeg[] = [];
  for (let i = 1; i < stops.length; i++) {
    legs.push({
      from: stops[i - 1],
      to: stops[i],
      walked: stops[i].index <= activeIndex,
      current: false,
    });
  }
  const lastWalked = [...legs].reverse().find((leg) => leg.walked);
  if (lastWalked) lastWalked.current = true;
  return legs;
}

export function presenceByPlace(
  nodes: FigureNode[],
  presence: PresenceEntry[],
  timeline: TimelineMoment[],
  activeId: string | null,
): Map<string, FigureNode[]> {
  const map = new Map<string, FigureNode[]>();
  if (!activeId) return map;
  for (const node of nodes) {
    if (node.type !== "person" && node.type !== "tier") continue;
    if (figureIsDeceased(node, timeline, activeId)) continue;
    const entry = resolvePresence(node.id, presence, timeline, activeId);
    if (!entry) continue;
    const guests = map.get(entry.placeId) ?? [];
    guests.push(node);
    map.set(entry.placeId, guests);
  }
  return map;
}

export function prunePresence(
  presence: PresenceEntry[],
  nodes: FigureNode[],
  timeline: TimelineMoment[],
): PresenceEntry[] {
  const ids = new Set(nodes.map((node) => node.id));
  const moments = new Set(timeline.map((moment) => moment.id));
  return presence.filter(
    (entry) =>
      ids.has(entry.elementId) &&
      ids.has(entry.placeId) &&
      (!entry.momentId || moments.has(entry.momentId)),
  );
}

export interface JourneyDuration {
  days?: number;
  label: string;
}

export function stopDateDiff(
  from: JourneyStop,
  to: JourneyStop,
  timeline: TimelineMoment[],
  timeSystem?: TimeSystem,
): JourneyDuration {
  if (timeSystem) {
    if (timeSystem.unit !== "day" || !from.momentId || !to.momentId)
      return { label: "Dauer unbekannt" };
    const fromTime = timeline.find((moment) => moment.id === from.momentId)?.time;
    const toTime = timeline.find((moment) => moment.id === to.momentId)?.time;
    if (!Number.isSafeInteger(fromTime) || !Number.isSafeInteger(toTime))
      return { label: "Dauer unbekannt" };
    const days = (toTime as number) - (fromTime as number);
    if (days < 0) return { days, label: "Zeitfolge unstimmig" };
    return { days, label: formatDuration(days) };
  }
  const fromDate = from.momentId
    ? timeline.find((moment) => moment.id === from.momentId)?.date
    : undefined;
  const toDate = to.momentId
    ? timeline.find((moment) => moment.id === to.momentId)?.date
    : undefined;
  const days = momentDateDiffDays(fromDate, toDate);
  if (days === undefined) return { label: "Dauer unbekannt" };
  if (days < 0) return { days, label: "Datumsfolge unstimmig" };
  return { days, label: formatDuration(days) };
}

export function journeyHandles(
  fromNode?: FigureNode,
  toNode?: FigureNode,
): { from: string; to: string } {
  if (!fromNode || !toNode || toNode.y >= fromNode.y)
    return { from: "journey-bottom", to: "journey-top" };
  return { from: "journey-top", to: "journey-bottom" };
}

export interface PlaceStay {
  elementId: string;
  arrivedAt: JourneyStop;
  leftAt?: JourneyStop;
  died: boolean;
}

export function placeJourney(
  placeId: string,
  nodes: FigureNode[],
  presence: PresenceEntry[],
  timeline: TimelineMoment[],
): PlaceStay[] {
  const stays: PlaceStay[] = [];
  for (const node of nodes) {
    if (node.type !== "person" && node.type !== "tier") continue;
    const stops = figureJourney(node, presence, timeline);
    const deathIndex = node.diedMomentId ? momentIndex(timeline, node.diedMomentId) : undefined;
    stops.forEach((stop, i) => {
      if (stop.placeId !== placeId) return;
      const next = stops[i + 1];
      let leftAt: JourneyStop | undefined;
      let died = false;
      if (next) leftAt = next;
      else if (deathIndex !== undefined) {
        leftAt = { placeId, momentId: node.diedMomentId, index: deathIndex };
        died = true;
      }
      if (leftAt && leftAt.index === stop.index) return;
      stays.push({ elementId: node.id, arrivedAt: stop, leftAt, died });
    });
  }
  return stays;
}

export interface PlaceMomentRow {
  index: number;
  moment?: TimelineMoment;
  occupants: FigureNode[];
  arrived: FigureNode[];
  left: FigureNode[];
}

export function placeChronicle(
  placeId: string,
  nodes: FigureNode[],
  presence: PresenceEntry[],
  timeline: TimelineMoment[],
): PlaceMomentRow[] {
  const stays = placeJourney(placeId, nodes, presence, timeline);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const indices = new Set<number>();
  stays.forEach((stay) => {
    indices.add(stay.arrivedAt.index);
    if (stay.leftAt) indices.add(stay.leftAt.index);
  });
  return [...indices]
    .sort((a, b) => a - b)
    .map((index) => ({
      index,
      moment: index >= 0 ? timeline[index] : undefined,
      occupants: stays
        .filter(
          (stay) => stay.arrivedAt.index <= index && (!stay.leftAt || index < stay.leftAt.index),
        )
        .map((stay) => nodeById.get(stay.elementId))
        .filter((node): node is FigureNode => !!node),
      arrived: stays
        .filter((stay) => stay.arrivedAt.index === index)
        .map((stay) => nodeById.get(stay.elementId))
        .filter((node): node is FigureNode => !!node),
      left: stays
        .filter((stay) => stay.leftAt?.index === index)
        .map((stay) => nodeById.get(stay.elementId))
        .filter((node): node is FigureNode => !!node),
    }));
}
