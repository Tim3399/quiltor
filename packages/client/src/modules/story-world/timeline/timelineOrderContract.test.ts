import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TimelineMoment } from "../model";
import { canonicalTimelineOrder } from "./order";

type FixtureRow = TimelineMoment & { expectedIndex: number };

function portableFixture(): FixtureRow[] {
  return readFileSync(join(process.cwd(), "contracts", "fixtures", "timeline-order.tsv"), "utf8")
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const [id, time, position, expectedIndex] = line.split("\t");
      return {
        id,
        title: id,
        time: Number(time),
        position: Number(position),
        expectedIndex: Number(expectedIndex),
      };
    });
}

describe("portable timeline order contract", () => {
  it("agrees with the fixture shared by Python and Rust", () => {
    const rows = portableFixture().reverse();
    const expected = [...rows]
      .sort((left, right) => left.expectedIndex - right.expectedIndex)
      .map(({ id }) => id);

    expect(canonicalTimelineOrder(rows).map(({ id }) => id)).toEqual(expected);
  });
});
