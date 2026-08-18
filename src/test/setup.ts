import "@testing-library/jest-dom/vitest";

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
