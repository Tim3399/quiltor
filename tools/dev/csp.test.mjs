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

test("the only wildcard is the Hugging Face CDN in connect-src and the WebLLM list is an array", () => {
  const policy = readPolicy();
  assert.ok(Array.isArray(policy.webllmHosts));
  const sources = buildPolicy({ design: true })
    .split("; ")
    .flatMap((item) =>
      item
        .split(" ")
        .slice(1)
        .map((source) => [item.split(" ")[0], source]),
    )
    .filter(([, source]) => source.includes("*"));
  assert.deepEqual(sources, [["connect-src", "https://*.cdn.hf.co"]]);
  const withHost = buildPolicy({ policy: { ...policy, webllmHosts: ["https://hf.example"] } });
  assert.equal(directive(withHost, "connect-src").at(-1), "https://hf.example");
});
