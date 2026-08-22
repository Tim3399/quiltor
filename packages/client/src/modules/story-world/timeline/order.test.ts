import { describe, expect, it } from "vitest";
import type { TimelineMoment } from "../model";
import {
  insertTimelineMoment,
  moveTimelineMoment,
  normalizeTimelineOrder,
  removeTimelineMoment,
} from "./order";

const moment = (id: string, time?: number): TimelineMoment => ({ id, title: id, time });

describe("canonical timeline ordering", () => {
  it("assigns the first legacy moment t0 and keeps simultaneous moments ordered by position", () => {
    expect(normalizeTimelineOrder([moment("a"), moment("b", 0)])).toEqual([
      expect.objectContaining({ id: "a", time: 0, position: 0 }),
      expect.objectContaining({ id: "b", time: 0, position: 1 }),
    ]);
  });

  it("creates signed coordinates before and after an existing timeline", () => {
    const before = insertTimelineMoment([moment("origin", 0)], moment("past"), 0);
    expect(before.map(({ id, time }) => [id, time])).toEqual([
      ["past", -1],
      ["origin", 0],
    ]);
    const after = insertTimelineMoment(before, moment("future"), before.length);
    expect(after.map(({ id, time }) => [id, time])).toEqual([
      ["past", -1],
      ["origin", 0],
      ["future", 1],
    ]);
  });

  it("opens an integer gap when inserting between consecutive time groups", () => {
    const result = insertTimelineMoment(
      [moment("a", 0), moment("b", 1), moment("c", 1)],
      moment("between"),
      1,
    );
    expect(result.map(({ id, time, position }) => [id, time, position])).toEqual([
      ["a", 0, 0],
      ["between", 1, 1],
      ["b", 2, 2],
      ["c", 2, 3],
    ]);
  });

  it("reorders inside a simultaneous group without changing its canonical time", () => {
    const result = moveTimelineMoment([moment("a", 0), moment("b", 0), moment("later", 1)], "a", 2);
    expect(result.map(({ id, time }) => [id, time])).toEqual([
      ["b", 0],
      ["a", 0],
      ["later", 1],
    ]);
  });

  it("moves across time groups and leaves deletion gaps intact", () => {
    const moved = moveTimelineMoment([moment("a", 0), moment("b", 4), moment("c", 8)], "c", 0);
    expect(moved.map(({ id, time }) => [id, time])).toEqual([
      ["c", -1],
      ["a", 0],
      ["b", 4],
    ]);
    expect(removeTimelineMoment(moved, "a").map(({ id, time }) => [id, time])).toEqual([
      ["c", -1],
      ["b", 4],
    ]);
  });
});
