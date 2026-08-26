import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import {
  analyzeMenuContractSource,
  discoverMenuContractFiles,
  scanMenuContracts,
} from "./menu_contracts.mjs";

const fixtureRoot = mkdtempSync(join(tmpdir(), "quiltor-menu-contracts-"));

after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

function write(path, source) {
  const file = resolve(fixtureRoot, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source, "utf8");
  return file;
}

test("accepts structured DropdownMenu consumers", () => {
  assert.deepEqual(
    analyzeMenuContractSource(`
      export function Actions() {
        return <DropdownMenu renderTrigger={(props) => <Button {...props} />} label="Aktionen">
          <MenuItem icon={<Pencil />} label="Umbenennen" onSelect={() => undefined} />
          <MenuItem icon={<Trash2 />} label="Löschen" tone="danger" onSelect={() => undefined} />
        </DropdownMenu>;
      }
    `),
    [],
  );
});

test("rejects manual menu composition, raw triggers and unstructured destructive items", () => {
  const violations = analyzeMenuContractSource(`
    export function Actions() {
      return <Popover><button aria-haspopup="menu">Mehr</button><Menu label="Aktionen">
        <MenuItem icon={<Trash2 />} onSelect={() => undefined}>Löschen</MenuItem>
      </Menu></Popover>;
    }
  `).join("\n");
  assert.match(violations, /renders <Menu> directly/);
  assert.match(violations, /aria-haspopup=menu directly/);
  assert.match(violations, /without the structured label prop/);
  assert.match(violations, /without tone="danger"/);
});

test("rejects the retired feature dropdown implementations", () => {
  assert.match(
    analyzeMenuContractSource('<details className="assistant-chapter-picker" />').join("\n"),
    /retired feature-owned dropdown class/,
  );
  assert.match(
    analyzeMenuContractSource('<details className="timeline-time-settings" />').join("\n"),
    /retired feature-owned dropdown class/,
  );
});

test("discovers productive files and reports paths while ignoring tests", () => {
  for (const root of [
    "packages/client/src/app",
    "packages/client/src/modules",
    "packages/client/src/shared",
  ]) {
    mkdirSync(resolve(fixtureRoot, root), { recursive: true });
  }
  write(
    "packages/client/src/modules/editor/Actions.tsx",
    '<button aria-haspopup="menu">Mehr</button>',
  );
  write(
    "packages/client/src/modules/editor/Actions.test.tsx",
    '<button aria-haspopup="menu">Test</button>',
  );

  assert.equal(discoverMenuContractFiles(fixtureRoot).length, 1);
  const violations = scanMenuContracts(fixtureRoot);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /Actions\.tsx: owns aria-haspopup=menu directly/);
});
