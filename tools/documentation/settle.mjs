// Waits until a README view has stopped moving, and gives up when it never does.
//
// The release (`set-version`) calls the capture, so a view that never settles -- a running
// animation, a resize loop -- must end in an error that names it, not in a hang.

export const SETTLE_POLL_MS = 100;
export const SETTLE_STABLE_POLLS = 5;
// Fit-view and the panels settle within a second or two; a run took under a minute in
// total. Thirty seconds per view leaves ample room for a slow machine and still ends well
// before a CI job timeout.
export const SETTLE_TIMEOUT_MS = 30_000;

/**
 * Polls `readState` until it returns the same value `stablePolls` times in a row.
 * `wait` and `now` are injectable so the bound can be tested without real time.
 */
export async function settleUntilStable(
  readState,
  {
    stablePolls = SETTLE_STABLE_POLLS,
    pollMs = SETTLE_POLL_MS,
    timeoutMs = SETTLE_TIMEOUT_MS,
    wait,
    now = () => Date.now(),
    label = "the page",
  },
) {
  const deadline = now() + timeoutMs;
  let previous = "";
  let changes = 0;
  let stable = 0;
  while (stable < stablePolls) {
    const state = await readState();
    if (state === previous) stable += 1;
    else {
      stable = 0;
      changes += 1;
    }
    previous = state;
    if (stable >= stablePolls) break;
    if (now() >= deadline) {
      throw new Error(
        `${label} did not settle: its layout state kept changing for ${timeoutMs} ms ` +
          `(${changes} changes, never ${stablePolls} identical polls ${pollMs} ms apart).`,
      );
    }
    await wait(pollMs);
  }
}
