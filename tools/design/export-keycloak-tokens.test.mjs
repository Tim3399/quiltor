import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildKeycloakTokens,
  COLOR_ROLES,
  COMPONENT_ROLES,
  colorThemes,
  componentRoles,
  geometry,
  lintThemeCss,
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
  // only the live touch height stays a variable
  assert.deepEqual([...new Set(css.match(/var\([^)]*\)/g))], ["var(--q-control-regular)"]);
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

test("every component role resolves in both themes", () => {
  const css = buildKeycloakTokens(readSources());
  for (const [name] of COMPONENT_ROLES) assert.match(css, new RegExp(`--q-${name}: `), name);
  assert.match(css, /--q-btn-primary-bg: #17150f;/);
  assert.match(css, /--q-page-bg: #2b2925;/, "dark page is --paper, as on SignInGate");
});

test("a component that changes its role changes the export", () => {
  const sources = readSources();
  const file = "primitives/Button/Button.css";
  const changed = sources.components[file].replace(
    /(\.ui-button--primary\.ui-button--neutral \{\s*border-color: var\(--ink\);\s*background: )var\(--ink\)/,
    "$1var(--soft)",
  );
  assert.notEqual(changed, sources.components[file], "fixture edit applied");
  const css = buildKeycloakTokens({
    ...sources,
    components: { ...sources.components, [file]: changed },
  });
  assert.match(css, /--q-btn-primary-bg: #474036;/);
});

test("a component rule that disappears is refused", () => {
  const sources = readSources();
  const themes = colorThemes(sources.colors);
  const components = {
    ...sources.components,
    "primitives/Button/Button.css": ".other { color: red; }",
  };
  assert.throws(
    () => componentRoles(components, themes, geometry(sources.tokens).root),
    /not found/,
  );
});

test("literal check: tokens and listed exceptions pass, invented values fail", () => {
  const ok = `.a { color: var(--q-ink); border: 1px solid var(--q-line); padding: 0 var(--q-btn-padding-inline);
    outline: 2px solid var(--q-focus); outline-offset: 2px; width: min(var(--q-sheet-max), 100%);
    padding-bottom: calc(var(--q-page-padding) + env(safe-area-inset-bottom)); }
    #kc-totp-secret-qr-code { background: #ffffff; }
    .x .sr-only { width: 1px; height: 1px; margin: -1px; }`;
  assert.deepEqual(lintThemeCss(ok), []);
  const bad = lintThemeCss(
    ".a { color: #17150f; padding: 24px; border-radius: 13px; display: flex; }",
  );
  assert.equal(bad.length, 3);
  assert.match(bad.join(" | "), /#17150f/);
});
