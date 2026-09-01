import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library unmounts after each test on its own only when a global
// `afterEach` exists. This suite runs without Vitest's globals -- every test
// imports `describe` and `it` explicitly -- so that registration never happens
// and component trees stay mounted for the rest of the file. A React update
// scheduled by one of them can then run after jsdom has been torn down, which
// surfaces as `window is not defined` from the scheduler and fails the whole
// run as an unhandled error while every test still reports as passing. It needs
// a slow enough machine to lose the race, which is why it shows up in CI.
afterEach(cleanup);

// Node exposes an experimental `localStorage` global when it is started with
// --localstorage-file. In some test runners that flag is present without a usable
// file, leaving jsdom with an object whose Storage methods are missing. Install a
// small, browser-compatible store so components can exercise persistence normally.
const values = new Map<string, string>();
const storage: Storage = {
  get length() {
    return values.size;
  },
  clear: () => values.clear(),
  getItem: (key) => values.get(String(key)) ?? null,
  key: (index) => [...values.keys()][index] ?? null,
  removeItem: (key) => {
    values.delete(String(key));
  },
  setItem: (key, value) => {
    values.set(String(key), String(value));
  },
};
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });

// Component tests use the web host composition unless a test explicitly
// configures another client.
const { configureQuiltorClient, createPlatformGateway, createQuiltorClient } = await import(
  "../platform"
);
const { createApplicationGatewayStub } = await import(
  "../platform/testing/createApplicationGatewayStub"
);
configureQuiltorClient(
  createQuiltorClient(createPlatformGateway(), createApplicationGatewayStub()),
);

// CodeMirror measures DOM ranges for virtualized lines. jsdom intentionally does
// not implement layout, so provide stable empty geometry for component tests.
if (!Range.prototype.getClientRects)
  Object.defineProperty(Range.prototype, "getClientRects", { value: () => [] });
if (!Range.prototype.getBoundingClientRect)
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    }),
  });
