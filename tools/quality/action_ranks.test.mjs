import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import {
  analyzeActionRankSource,
  discoverActionRankFiles,
  isActionRankProductFile,
  scanActionRanks,
} from "./action_ranks.mjs";

const fixtureRoot = mkdtempSync(join(tmpdir(), "quiltor-action-ranks-"));

after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

function write(path, source) {
  const file = resolve(fixtureRoot, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source, "utf8");
  return file;
}

const strip = (body) => `
  export function Toolbar() {
    return (
      <WorkspaceToolbarActions
        ${body}
      />
    );
  }
`;

test("accepts a strip whose only emphasis is the create contract", () => {
  assert.deepEqual(
    analyzeActionRankSource(
      strip(`
        create={<WorkspaceToolbarCreateButton label="Neues Kapitel" onClick={add} />}
        view={<ToolbarButton label="Kapitel" icon={<PanelLeft />} aria-pressed={binderOpen} />}
        actions={<ToolbarButton label="Exportieren" icon={<Download />} />}
      `),
    ),
    [],
  );
});

test("rejects a second emphasised action in a strip", () => {
  assert.deepEqual(
    analyzeActionRankSource(
      strip(`
        create={<WorkspaceToolbarCreateButton label="Neu" onClick={add} />}
        actions={<ToolbarButton appearance="primary" label="Exportieren" icon={<Download />} />}
      `),
    ),
    ["<ToolbarButton> claims primary emphasis; only the create contract may"],
  );
});

test("rejects a toggle that shouts", () => {
  assert.deepEqual(
    analyzeActionRankSource(
      strip(`
        view={<Button appearance="secondary" aria-pressed={focus} onClick={toggle}>Fokus</Button>}
      `),
    ),
    ["<Button> is a toggle with secondary emphasis; a toggle stays quiet"],
  );
});

test("leaves files without an action strip alone", () => {
  assert.deepEqual(
    analyzeActionRankSource(`
      export function ConfirmDialog() {
        return <Button appearance="primary" onClick={confirm}>Löschen</Button>;
      }
    `),
    [],
  );
});

test("reads nested braces in attributes without losing the element", () => {
  assert.deepEqual(
    analyzeActionRankSource(
      strip(`
        view={
          <ToolbarButton
            label={t("focus")}
            onClick={() => { if (ready) { onFocus(!focus); } }}
            appearance="primary"
          />
        }
      `),
    ),
    ["<ToolbarButton> claims primary emphasis; only the create contract may"],
  );
});

test("scans product sources and skips tests and stories", () => {
  write(
    "packages/client/src/modules/demo/DemoToolbar.tsx",
    strip(`actions={<ToolbarButton appearance="primary" label="Exportieren" />}`),
  );
  write(
    "packages/client/src/modules/demo/DemoToolbar.test.tsx",
    strip(`actions={<ToolbarButton appearance="primary" label="Exportieren" />}`),
  );
  write(
    "packages/client/src/modules/demo/DemoToolbar.story.tsx",
    strip(`actions={<ToolbarButton appearance="primary" label="Exportieren" />}`),
  );
  write("packages/client/src/app/Shell.tsx", "export const shell = 1;\n");

  assert.equal(
    isActionRankProductFile("packages/client/src/modules/demo/DemoToolbar.test.tsx"),
    false,
  );
  assert.equal(discoverActionRankFiles(fixtureRoot).length, 2);
  assert.deepEqual(scanActionRanks(fixtureRoot), [
    "packages/client/src/modules/demo/DemoToolbar.tsx: <ToolbarButton> claims primary emphasis; only the create contract may",
  ]);
});
