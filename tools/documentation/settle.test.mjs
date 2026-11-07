import assert from "node:assert/strict";
import { test } from "node:test";
import { settleUntilStable } from "./settle.mjs";

function clock() {
  let time = 0;
  return {
    now: () => time,
    wait: async (ms) => {
      time += ms;
    },
  };
}

test("settleUntilStable returns once the state repeats", async () => {
  const { now, wait } = clock();
  const states = ["a", "b", "c", "c", "c", "c", "c", "c"];
  let polls = 0;
  await settleUntilStable(async () => states[Math.min(polls++, states.length - 1)], {
    now,
    wait,
  });
  assert.equal(polls, 8);
});

test("settleUntilStable gives up on a state that never stops changing", async () => {
  const { now, wait } = clock();
  let polls = 0;
  await assert.rejects(
    settleUntilStable(async () => String(polls++), {
      timeoutMs: 1_000,
      label: "the world graph",
      now,
      wait,
    }),
    /the world graph did not settle: .* 1000 ms/,
  );
  assert.ok(polls <= 12, `kept polling ${polls} times past the deadline`);
});
