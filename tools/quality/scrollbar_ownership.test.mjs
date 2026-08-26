import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import {
  analyzeScrollbarOwnershipSource,
  discoverScrollbarOwnershipFiles,
  scanScrollbarOwnership,
  scrollbarOwner,
} from "./scrollbar_ownership.mjs";

const fixtureRoot = mkdtempSync(join(tmpdir(), "quiltor-scrollbar-ownership-"));

after(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function write(path, source) {
  const file = resolve(fixtureRoot, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source, "utf8");
  return file;
}

test("allows scrollbar recipes only in the exact public ScrollArea CSS owner", () => {
  const source = `
    .scroll-area { scrollbar-color: red transparent; scrollbar-width: thin; }
    .scroll-area::-webkit-scrollbar-thumb { background: red; }
  `;
  assert.deepEqual(analyzeScrollbarOwnershipSource({ file: scrollbarOwner, source }), []);

  const violations = analyzeScrollbarOwnershipSource({
    file: "packages/client/src/modules/editor/Editor.css",
    source,
  });
  assert.deepEqual(
    violations.map(({ kind, line }) => [kind, line]),
    [
      ["scrollbar-color", 2],
      ["scrollbar-width", 2],
      ["webkit-scrollbar-selector", 3],
    ],
  );
});

test("rejects feature-local scrollbar-width even without a color recipe", () => {
  assert.deepEqual(
    analyzeScrollbarOwnershipSource({
      file: "packages/client/src/modules/editor/Editor.css",
      source: ".editor-scroll { overflow: auto; scrollbar-width: thin; }",
    }).map(({ kind }) => kind),
    ["scrollbar-width"],
  );
});

test("ignores recipe-looking comments and string contents", () => {
  const source = `
    /* .fake::-webkit-scrollbar { scrollbar-color: red blue; } */
    .example::before {
      content: "::-webkit-scrollbar-thumb scrollbar-color: red blue";
      --documentation: 'scrollbar-color: red blue';
    }
  `;
  assert.deepEqual(
    analyzeScrollbarOwnershipSource({
      file: "packages/client/src/modules/editor/Editor.css",
      source,
    }),
    [],
  );
});

test("grants no AppShell exception for hidden scrollbar recipes", () => {
  const source = `
    @media (max-width: 719px) {
      .app-bar .workspace-switch::-webkit-scrollbar {
        display: none;
      }
    }
  `;
  assert.deepEqual(
    analyzeScrollbarOwnershipSource({
      file: "packages/client/src/app/AppShell.css",
      source,
    }).map(({ kind }) => kind),
    ["webkit-scrollbar-selector"],
  );
});

test("decodes CSS escapes instead of allowing them to bypass ownership", () => {
  const source = String.raw`
    .panel { scrollbar\2d color: auto; }
    .panel::\2d webkit-scrollbar-thumb { color: red; }
  `;
  assert.deepEqual(
    analyzeScrollbarOwnershipSource({
      file: "packages/client/src/modules/editor/Editor.css",
      source,
    }).map(({ kind }) => kind),
    ["scrollbar-color", "webkit-scrollbar-selector"],
  );
});

test("fails closed when CSS is malformed", () => {
  assert.throws(
    () =>
      analyzeScrollbarOwnershipSource({
        file: "packages/client/src/modules/editor/Editor.css",
        source: '.panel { content: "unterminated; }',
      }),
    /could not parse/,
  );
});

test("discovers only productive client CSS and requires the public owner", () => {
  write(scrollbarOwner, ".scroll-area { overflow: auto; }");
  write("packages/client/src/app/App.css", ".app { overflow: auto; }");
  write("packages/client/src/app/App.test.css", ".test { overflow: auto; }");
  write("packages/client/src/modules/editor/Editor.story.css", ".story { overflow: auto; }");
  write("packages/client/src/design/testing/gallery/Gallery.css", ".gallery { overflow: auto; }");

  assert.deepEqual(
    discoverScrollbarOwnershipFiles(fixtureRoot).map((file) =>
      file.replaceAll("\\", "/").replace(`${fixtureRoot.replaceAll("\\", "/")}/`, ""),
    ),
    ["packages/client/src/app/App.css", scrollbarOwner],
  );
  assert.deepEqual(scanScrollbarOwnership(fixtureRoot), []);

  const missingOwnerRoot = mkdtempSync(join(tmpdir(), "quiltor-scrollbar-owner-missing-"));
  try {
    writeFileSync(resolve(missingOwnerRoot, "placeholder"), "", "utf8");
    assert.throws(
      () => scanScrollbarOwnership(missingOwnerRoot),
      /ScrollArea CSS owner is missing/,
    );
  } finally {
    rmSync(missingOwnerRoot, { recursive: true, force: true });
  }
});
