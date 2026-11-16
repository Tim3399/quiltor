// The Content-Security-Policy, built from src/quiltor/bootstrap/csp-policy.json (T-61 part 5).
//
// The JSON is the one source: the Python server reads it for every HTML answer, and this module
// builds the same header for the design gallery, which adds 'unsafe-inline' to script-src for
// the inline preamble of @vitejs/plugin-react. That exception exists only here.

import { readFileSync } from "node:fs";

const POLICY_URL = new URL("../../src/quiltor/bootstrap/csp-policy.json", import.meta.url);

export function readPolicy() {
  return JSON.parse(readFileSync(POLICY_URL, "utf8"));
}

export function buildPolicy({ design = false, policy = readPolicy() } = {}) {
  const directives = Object.fromEntries(
    Object.entries(policy.directives).map(([name, values]) => [name, [...values]]),
  );
  directives["connect-src"].push(...policy.webllmHosts);
  if (design) directives["script-src"].push(...policy.designScriptSrcExtra);
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}
