import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { checkPlatformBoundaries } from "./platform_boundaries.mjs";

const fixtureRoot = mkdtempSync(join(tmpdir(), "quiltor-platform-boundaries-"));
after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

let count = 0;
function client(files) {
  const root = resolve(fixtureRoot, String(count++));
  for (const [path, text] of Object.entries(files)) {
    const file = resolve(root, "packages/client/src", path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, "utf8");
  }
  return checkPlatformBoundaries(root);
}

const branch = "export const offer = (who: { multiUser?: boolean }) => who.multiUser === true;\n";

test("multiUser outside the wire and the capabilities is a violation", () => {
  assert.deepEqual(client({ "modules/cloud/Offer.tsx": branch }), [
    "packages/client/src/modules/cloud/Offer.tsx:1: branch on a capability flag, not on multiUser (T-102)",
  ]);
  assert.equal(client({ "app/Application.tsx": branch }).length, 1);
});

test("multiUser may appear on the wire, where capabilities are derived, and in tests", () => {
  assert.deepEqual(
    client({
      "platform/http/identity.ts": branch,
      "platform/contracts/v1/capabilities.ts": branch,
      "shared/capabilities.tsx": branch,
      "app/shell/useCapabilities.ts": branch,
      "app/shell/useShellStatus.ts": branch,
      "modules/cloud/Offer.test.tsx": branch,
      "modules/cloud/Offer.testSupport.ts": branch,
      "test/setup.ts": branch,
    }),
    [],
  );
});

test("a word that only contains multiUser is not a violation", () => {
  assert.deepEqual(client({ "modules/cloud/Offer.ts": "const multiUsers = 2;\n" }), []);
});

test("the existing rules still hold", () => {
  assert.deepEqual(
    client({
      "modules/a.ts": 'if (profile === "hosted") {}\n',
      "modules/b.ts": "localStorage.clear();\n",
      "platform/c.ts": "localStorage.clear();\n",
    }),
    [
      "packages/client/src/modules/b.ts:1: access persistent storage through PlatformGateway",
      "packages/client/src/modules/a.ts:1: branch on a capability flag such as installable, not on the operation profile",
    ],
  );
});
