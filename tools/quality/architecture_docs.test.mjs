import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { architectureDocViolations, architectureViewPaths } from "./architecture_docs.mjs";

const roots = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function write(root, path, source) {
  const file = resolve(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source, "utf8");
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "quiltor-architecture-docs-"));
  roots.push(root);
  const registrations = architectureViewPaths.map((path) => `[view](${path})`).join("\n");
  write(
    root,
    "target-component-model.md",
    `Status: **normative boundaries with proposed class-level reference views**\n${registrations}`,
  );
  write(
    root,
    "implementation-plan.md",
    [
      "Status: **normative delivery plan**",
      "complete World Storage boundary",
      "A generic command/query bus",
      "WorldAssetId",
    ].join("\n"),
  );
  for (const viewPath of architectureViewPaths) {
    let body =
      "Status: **proposed target view**\n```mermaid\nflowchart LR\nA-->B\n```\nCurrent code";
    if (viewPath.endsWith("core-software.md")) body += "\nWorldAssetId CommitPlan";
    if (viewPath.endsWith("application-and-persistence.md")) {
      body += "\nWorldCommitRepository CommitPlan";
    }
    if (viewPath.endsWith("assistant-and-inference.md")) {
      body += "\nAcceptAssistantProposalUseCase AuthorizationPolicy ProposalAcceptancePolicy";
    }
    if (viewPath.endsWith("cross-feature-projections.md")) {
      body += "\nDraftContext canonical Assistant context";
    }
    write(root, viewPath, body);
  }
  write(
    root,
    "decisions/0003-portable-local-core.md",
    "Status: superseded by 0006-portable-core-boundary-and-migration-gates.md",
  );
  write(
    root,
    "decisions/0006-portable-core-boundary-and-migration-gates.md",
    "Status: accepted; supersedes 0003-portable-local-core.md",
  );
  return root;
}

test("accepts one coherent architecture authority chain", () => {
  assert.deepEqual(architectureDocViolations(fixture()), []);
});

test("rejects a missing or duplicate registered view", () => {
  const root = fixture();
  write(
    root,
    "target-component-model.md",
    "Status: **normative boundaries with proposed class-level reference views**\n[core](views/core-software.md)\n[core again](views/core-software.md)",
  );
  assert.match(architectureDocViolations(root).join("\n"), /must appear exactly once/);
});

test("rejects retired global dispatch, snapshot and asset-handle assumptions", () => {
  const root = fixture();
  write(
    root,
    "views/core-software.md",
    "Status: **proposed target view**\n```mermaid\nclassDiagram\nclass CommandDispatcher\nclass WorldProjectSnapshot\n```\nCurrent code\n+DocumentHandle background",
  );
  const output = architectureDocViolations(root).join("\n");
  assert.match(output, /class CommandDispatcher/);
  assert.match(output, /class WorldProjectSnapshot/);
  assert.match(output, /DocumentHandle background/);
});

test("rejects a direct Assistant path without application policies", () => {
  const root = fixture();
  write(
    root,
    "views/assistant-and-inference.md",
    "Status: **proposed target view**\n```mermaid\nflowchart LR\nUI-->Core\n```\nCurrent code",
  );
  const output = architectureDocViolations(root).join("\n");
  assert.match(output, /AcceptAssistantProposalUseCase/);
  assert.match(output, /AuthorizationPolicy/);
  assert.match(output, /ProposalAcceptancePolicy/);
});

test("requires reciprocal supersession for the Rust migration ADR", () => {
  const root = fixture();
  write(root, "decisions/0003-portable-local-core.md", "Status: accepted");
  assert.match(architectureDocViolations(root).join("\n"), /superseding ADR 0006/);
});
