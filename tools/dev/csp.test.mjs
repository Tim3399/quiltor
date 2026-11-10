import assert from "node:assert/strict";
import test from "node:test";

import { buildPolicy, readPolicy } from "./csp.mjs";

function directive(policy, name) {
  return policy
    .split("; ")
    .find((item) => item.startsWith(`${name} `))
    ?.split(" ")
    .slice(1);
}

test("only the design gallery allows inline scripts", () => {
  assert.deepEqual(directive(buildPolicy(), "script-src"), ["'self'", "'wasm-unsafe-eval'"]);
  assert.ok(directive(buildPolicy({ design: true }), "script-src").includes("'unsafe-inline'"));
});

test("the policy names no wildcard and keeps the WebLLM list exact", () => {
  const policy = readPolicy();
  assert.ok(Array.isArray(policy.webllmHosts));
  assert.ok(!buildPolicy({ design: true }).includes("*"));
  const withHost = buildPolicy({ policy: { ...policy, webllmHosts: ["https://hf.example"] } });
  assert.equal(directive(withHost, "connect-src").at(-1), "https://hf.example");
});
