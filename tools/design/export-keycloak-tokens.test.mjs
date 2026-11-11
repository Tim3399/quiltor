import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildKeycloakTokens,
  COLOR_ROLES,
  colorThemes,
  geometry,
  OUTPUT,
  readSources,
  resolve,
} from "./export-keycloak-tokens.mjs";

const COLORS = `
:root,
:root[data-theme="light"] {
  --surface-paper: #fcf6ed;
  --text-primary: #17150f;
}
:root[data-theme="dark"] {
  --surface-paper: #2b2925;
  --text-primary: #eee8df;
}
:root {
  --ink: var(--text-primary);
}
`;

const TOKENS = `
:root {
  --space-12: 12px;
  --spacing-control-inline: var(--space-12);
  --control-touch: 44px;
  --control-regular: 36px;
}
@media (max-width: 719px), (pointer: coarse) {
  :root {
    --control-regular: var(--control-touch);
  }
}
`;

test("resolves a var() chain per theme, theme values before shared ones", () => {
  const themes = colorThemes(COLORS);
  assert.equal(resolve([themes.light, themes.shared], "--ink"), "#17150f");
  assert.equal(resolve([themes.dark, themes.shared], "--ink"), "#eee8df");
});

test("reads the :root tokens and the touch override from tokens.css", () => {
  const geo = geometry(TOKENS);
  assert.equal(geo.root.get("--spacing-control-inline"), "var(--space-12)");
  assert.equal(geo.touch.get("--control-regular"), "var(--control-touch)");
});

test("reports an undefined and a cyclic alias", () => {
  const themes = colorThemes(":root { --a: var(--b); --b: var(--a); --c: var(--nope); }");
  assert.throws(() => resolve([themes.shared], "--a"), /cyclic alias/);
  assert.throws(() => resolve([themes.shared], "--c"), /--nope is not defined/);
});

test("the real design sources export without an unresolved role", () => {
  const css = buildKeycloakTokens(readSources());
  for (const name of Object.keys(COLOR_ROLES)) {
    assert.equal(
      css.match(new RegExp(`--q-${name}: `, "g"))?.length,
      2,
      `--q-${name} light and dark`,
    );
  }
  assert.doesNotMatch(css, /var\(/);
  assert.doesNotMatch(css, /data-theme/);
});

test("dark values go into prefers-color-scheme, the touch height into its media query", () => {
  const css = buildKeycloakTokens(readSources());
  const dark = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));
  assert.match(css, /^:root \{[^}]*--q-ink: #17150f;/m);
  assert.match(dark, /--q-ink: #eee8df;/);
  assert.match(
    css,
    /@media \(max-width: 719px\), \(pointer: coarse\) \{\s*:root \{\s*--q-control-regular: 44px;/,
  );
});

test("font stacks only with --fonts-from-quiltor (T-239)", () => {
  const sources = readSources();
  assert.doesNotMatch(buildKeycloakTokens(sources), /--q-ui:/);
  assert.match(buildKeycloakTokens({ ...sources, fontsFromQuiltor: true }), /--q-ui: Inter,/);
});

test("the checked-in reference file is current", () => {
  const current = readFileSync(OUTPUT, "utf8").replaceAll("\r\n", "\n");
  assert.equal(current, buildKeycloakTokens(readSources()));
});

test("a fixture without the touch override is refused", () => {
  assert.throws(
    () => buildKeycloakTokens({ colors: COLORS, tokens: ":root { --control-regular: 36px; }" }),
    /touch override/,
  );
});
