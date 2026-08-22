import assert from "node:assert/strict";
import test from "node:test";
import { designIndexImports, designIndexViolations } from "./css_ownership.mjs";

const validIndex = `${designIndexImports.map((path) => `@import "${path}";`).join("\n")}\n`;

test("the design entrypoint contains exactly the authorized imports", () => {
  assert.deepEqual(designIndexViolations(validIndex), []);
});

test("the design entrypoint cannot become a global rule owner", () => {
  assert.match(
    designIndexViolations(`${validIndex}.app-shell { color: red; }`).join("\n"),
    /not an authorized import-only declaration/,
  );
});

test("the design entrypoint cannot silently omit or reorder owners", () => {
  assert.match(
    designIndexViolations(validIndex.replace('@import "./colors.css";\n', "")).join("\n"),
    /exactly match/,
  );
});
