import { test } from "./support/world-fixture";

// A job on a browser engine, end to end against dist/ with the cspGuard (T-61 part 6).
//
// It needs an engine the page can actually run, and the first one is the cloud executor's test
// profile from T-61 part 8: offered only when the server reports instance.testHooks
// (QUILTOR_TEST_HOOKS=1), with Playwright answering the provider call through page.route.
// Until part 8 lands the registry has no engine, the status view offers no choice, and these
// tests have nothing to drive. Part 8 replaces each fixme with the test it describes; the relay
// loop itself is covered by vitest (useRelayLoop.test.ts and the conversation test).
const NEEDS = "needs the cloud executor's test profile from T-61 part 8";

test.fixme(`The answer of a browser engine appears in the conversation (${NEEDS})`, () => {});

test.fixme(`A second tab with a running client job gets the 429 notice (${NEEDS})`, () => {});

test.fixme(`After a cancel a new job can start at once (${NEEDS})`, () => {});

test.fixme(`Closing the tab lets the client job fail (${NEEDS})`, () => {});
