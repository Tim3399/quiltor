import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { anchorsOf, checkMarkdownLinks, REPOSITORY_URL, slug } from "./markdown_links.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const scratch = [];
after(() => {
  for (const directory of scratch) rmSync(directory, { recursive: true, force: true });
});

/** A small repository: `files` maps a path to its content. */
function workspace(files) {
  const root = mkdtempSync(join(tmpdir(), "quiltor-md-links-"));
  scratch.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return {
    root,
    check: () =>
      checkMarkdownLinks(
        root,
        Object.keys(files).filter((f) => f.endsWith(".md")),
      ),
  };
}

test("GitHub's anchor for a heading keeps letters, digits, hyphens and umlauts", () => {
  assert.equal(slug("Status und Lizenz"), "status-und-lizenz");
  assert.equal(slug("Entwicklung und Qualität"), "entwicklung-und-qualität");
  assert.equal(slug("Scope `quiltor.backup`"), "scope-quiltorbackup");
  assert.equal(slug("Local data, history, and restore"), "local-data-history-and-restore");
  assert.equal(slug("[Linked](x.md) heading"), "linked-heading");
});

test("links that resolve, in every form, are fine", () => {
  const { check } = workspace({
    "README.md": '# Title\n\n## Schnellstart\n\n<a id="named"></a>\n',
    "docs/guide.md": [
      "# Guide",
      "",
      "[same file](#guide) [readme](../README.md#schnellstart) [named](../README.md#named)",
      `[absolute](${REPOSITORY_URL}README.md#schnellstart) [folder](../docs/)`,
      "[web](https://example.com/x) [mail](mailto:a@b.c)",
      "",
    ].join("\n"),
  });
  assert.deepEqual(check(), []);
});

test("a relative link to a missing file is reported", () => {
  const { check } = workspace({ "a.md": "[gone](missing.md)\n" });
  assert.match(check().join("\n"), /a\.md:1: missing\.md names a file that does not exist/);
});

test("an anchor missing in another file is reported", () => {
  const { check } = workspace({
    "README.md": "## Quick start\n",
    "docs/a.md": "[start](../README.md#schnellstart)\n",
  });
  assert.match(check().join("\n"), /has no anchor "#schnellstart" in README\.md/);
});

test("an absolute link to this repository is checked as the local file", () => {
  const { check } = workspace({
    "README.md": `[docs](${REPOSITORY_URL}docs/missing.md) [anchor](${REPOSITORY_URL}README.md#nope)\n`,
  });
  const problems = check().join("\n");
  assert.match(problems, /docs\/missing\.md names a file that does not exist/);
  assert.match(problems, /has no anchor "#nope" in README\.md/);
});

test("a repeated heading gets GitHub's numeric suffix", () => {
  const { root } = workspace({ "a.md": "## Setup\n\n## Setup\n" });
  assert.deepEqual([...anchorsOf(join(root, "a.md"))], ["setup", "setup-1"]);
});

test("links inside code are not links", () => {
  const { check } = workspace({
    "a.md": "```md\n[gone](missing.md)\n```\n\nInline `[gone](missing.md)` too.\n",
  });
  assert.deepEqual(check(), []);
});

test("the README anchors other documents point at exist", () => {
  // docs/ERSTE-SCHRITTE.md, docs/GETTING-STARTED.md and the sync documents link these.
  assert.ok(anchorsOf(join(repositoryRoot, "README.md")).has("schnellstart"));
  assert.ok(anchorsOf(join(repositoryRoot, "README.md")).has("status-und-lizenz"));
  assert.ok(anchorsOf(join(repositoryRoot, "README.en.md")).has("quick-start"));
  assert.ok(anchorsOf(join(repositoryRoot, "README.en.md")).has("status-and-license"));
});
