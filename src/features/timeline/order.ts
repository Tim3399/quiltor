import type { TimelineMoment } from "../../types";

function timeOf(moment: TimelineMoment, fallback: number): number {
  return typeof moment.time === "number" && Number.isInteger(moment.time) ? moment.time : fallback;
}

export function normalizeTimelineOrder(timeline: TimelineMoment[]): TimelineMoment[] {
  let previous = -1;
  return timeline.map((moment, position) => {
    const time = timeOf(moment, previous + 1);
    previous = time;
    return { ...moment, time, position };
  });
}

export function insertTimelineMoment(
  timeline: TimelineMoment[],
  moment: TimelineMoment,
  requestedIndex: number,
  preferredTime?: number,
): TimelineMoment[] {
  const current = normalizeTimelineOrder(timeline);
  const index = Math.max(0, Math.min(current.length, requestedIndex));
  const previous = current[index - 1];
  const next = current[index];
  const previousTime = previous ? timeOf(previous, 0) : undefined;
  const nextTime = next ? timeOf(next, previousTime ?? 0) : undefined;
  let time: number;

  if (
    typeof preferredTime === "number" &&
    Number.isInteger(preferredTime) &&
    (previousTime === preferredTime || nextTime === preferredTime)
  ) {
    time = preferredTime;
  } else if (previousTime === undefined && nextTime === undefined) {
    time = 0;
  } else if (previousTime === undefined) {
    time = (nextTime ?? 1) - 1;
  } else if (nextTime === undefined) {
    time = previousTime + 1;
  } else if (previousTime === nextTime) {
    time = previousTime;
  } else if (nextTime - previousTime > 1) {
    time = previousTime + 1;
  } else {
    time = previousTime + 1;
    for (let offset = index; offset < current.length; offset += 1) {
      current[offset] = {
        ...current[offset],
        time: timeOf(current[offset], time) + 1,
      };
    }
  }

  current.splice(index, 0, { ...moment, time });
  return current.map((item, position) => ({ ...item, position }));
}

export function insertTimelineMomentAtTime(
  timeline: TimelineMoment[],
  moment: TimelineMoment,
  requestedIndex: number,
  time: number,
): TimelineMoment[] {
  const current = normalizeTimelineOrder(timeline);
  const index = Math.max(0, Math.min(current.length, requestedIndex));
  current.splice(index, 0, { ...moment, time });
  return current.map((item, position) => ({ ...item, position }));
}

export function moveTimelineMoment(
  timeline: TimelineMoment[],
  momentId: string,
  requestedIndex: number,
): TimelineMoment[] {
  const current = normalizeTimelineOrder(timeline);
  const from = current.findIndex((moment) => moment.id === momentId);
  if (from < 0) return current;
  const [moment] = current.splice(from, 1);
  const adjusted = Math.max(
    0,
    Math.min(current.length, requestedIndex > from ? requestedIndex - 1 : requestedIndex),
  );
  return insertTimelineMoment(current, moment, adjusted, moment.time);
}

export function setTimelineMomentTime(
  timeline: TimelineMoment[],
  momentId: string,
  time: number,
): TimelineMoment[] {
  return normalizeTimelineOrder(timeline)
    .map((moment) => (moment.id === momentId ? { ...moment, time } : moment))
    .sort(
      (left, right) =>
        (left.time as number) - (right.time as number) ||
        (left.position as number) - (right.position as number),
    )
    .map((moment, position) => ({ ...moment, position }));
}

export function removeTimelineMoment(
  timeline: TimelineMoment[],
  momentId: string,
): TimelineMoment[] {
  return normalizeTimelineOrder(timeline.filter((moment) => moment.id !== momentId));
}
