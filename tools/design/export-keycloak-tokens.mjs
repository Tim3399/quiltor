import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/*
 * Exports the Quiltor design tokens for the Keycloak theme "quiltor" (T-175).
 *
 *   node tools/design/export-keycloak-tokens.mjs           write distribution/keycloak/quiltor-tokens.css
 *   node tools/design/export-keycloak-tokens.mjs --check   fail when that file is stale
 *
 * The theme lives in the infrastructure repository, so it cannot import these files. It
 * carries a copy of the generated file instead, and this check keeps the reference copy here
 * in step with colors.css and tokens.css: a changed token turns `npm run check` red until the
 * file is regenerated and carried over.
 *
 * colors.css switches themes through :root[data-theme], which a login page cannot set. The
 * export resolves every var() chain per theme down to its literal and writes the dark values
 * into @media (prefers-color-scheme: dark) instead.
 *
 * The font stacks are not exported yet: the theme ships Figtree and Playfair Display itself
 * (D-163) while the client still uses system stacks. --fonts-from-quiltor adds them once
 * the client switches (T-239).
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const designRoot = join(root, "packages", "client", "src", "design");
export const OUTPUT = join(root, "distribution", "keycloak", "quiltor-tokens.css");

// Theme variable -> Quiltor color role. Only roles that exist in colors.css.
export const COLOR_ROLES = Object.freeze({
  canvas: "--surface-canvas",
  chrome: "--surface-chrome",
  panel: "--surface-panel",
  paper: "--surface-paper",
  raised: "--surface-raised",
  ink: "--ink",
  soft: "--soft",
  muted: "--muted",
  line: "--line",
  "line-default": "--border-default",
  "line-strong": "--line-strong",
  gold: "--gold",
  "gold-border": "--gold-border",
  link: "--link",
  "link-hover": "--link-hover",
  focus: "--focus",
  "control-hint": "--control-hint",
  "control-hover": "--control-hover",
  "disabled-surface": "--disabled-surface",
  "disabled-content": "--disabled-content",
  shadow: "--shadow-color",
  danger: "--danger",
  "error-bg": "--error-bg",
  "error-border": "--error-border",
  "success-text": "--success-text",
  "success-bg": "--success-bg",
  "success-border": "--success-border",
  "warning-text": "--warning-text",
  "warning-bg": "--warning-bg",
  "warning-border": "--warning-border",
  "info-text": "--info-text",
  "info-bg": "--info-bg",
  "info-border": "--info-border",
});

// Theme variable -> Quiltor geometry token (tokens.css, :root).
export const GEOMETRY_TOKENS = Object.freeze({
  "control-regular": "--control-regular",
  "control-touch": "--control-touch",
  radius: "--radius",
  "radius-sm": "--radius-sm",
  "radius-lg": "--radius-lg",
  "radius-xl": "--radius-xl",
  elevation: "--elevation-1",
  "font-size-eyebrow": "--font-size-2",
  "font-size-label": "--font-size-label-compact",
  "font-size-body": "--font-size-body",
  "font-size-control": "--font-size-control",
  "font-size-section": "--font-size-section-title",
  "tracking-label": "--tracking-label",
  "spacing-control-inline": "--spacing-control-inline",
});

export const FONT_TOKENS = Object.freeze({ ui: "--ui", prose: "--prose", mono: "--mono" });

const stripComments = (source) => source.replaceAll(/\/\*[\s\S]*?\*\//g, "");

function declarations(body) {
  const map = new Map();
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(match[1], match[2].trim().replaceAll(/\s+/g, " "));
  }
  return map;
}

/** Splits colors.css into light, dark and shared declarations, by top-level selector. */
export function colorThemes(source) {
  const themes = { light: new Map(), dark: new Map(), shared: new Map() };
  for (const match of stripComments(source).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim();
    const target = selector.includes(':root[data-theme="dark"]')
      ? themes.dark
      : selector.includes(':root[data-theme="light"]')
        ? themes.light
        : selector === ":root"
          ? themes.shared
          : undefined;
    if (!target) continue;
    for (const [name, value] of declarations(match[2])) target.set(name, value);
  }
  return themes;
}

/** Resolves a whole-value var() chain; theme declarations win over shared ones. */
export function resolve(maps, name, seen = new Set()) {
  if (seen.has(name)) throw new Error(`cyclic alias at ${name}`);
  const value = maps.map((m) => m.get(name)).find((v) => v !== undefined);
  if (value === undefined) throw new Error(`${name} is not defined`);
  const alias = /^var\(\s*(--[\w-]+)\s*\)$/u.exec(value)?.[1];
  return alias ? resolve(maps, alias, new Set([...seen, name])) : value;
}

/** :root declarations of tokens.css, plus the touch override of the control heights. */
export function geometry(source) {
  const clean = stripComments(source);
  const rootMap = new Map();
  for (const match of clean.matchAll(/(^|\})\s*:root\s*\{([^{}]*)\}/g)) {
    for (const [name, value] of declarations(match[2])) rootMap.set(name, value);
  }
  const touch =
    /@media\s*\(max-width:\s*719px\),\s*\(pointer:\s*coarse\)\s*\{\s*:root\s*\{([^{}]*)\}/u.exec(
      clean,
    );
  if (!touch)
    throw new Error(
      "tokens.css: touch override @media (max-width: 719px), (pointer: coarse) not found",
    );
  return { root: rootMap, touch: declarations(touch[1]) };
}

/** Resolves a token value; var() references inside a larger value are resolved too. */
function resolveToken(map, value, seen = new Set()) {
  return value.replaceAll(/var\(\s*(--[\w-]+)\s*\)/g, (_, name) => {
    if (seen.has(name)) throw new Error(`cyclic token at ${name}`);
    const next = map.get(name);
    if (next === undefined) throw new Error(`${name} is not defined in tokens.css`);
    return resolveToken(map, next, new Set([...seen, name]));
  });
}

export function buildKeycloakTokens({ colors, tokens, fontsFromQuiltor = false }) {
  const themes = colorThemes(colors);
  const block = (theme) =>
    Object.entries(COLOR_ROLES).map(
      ([name, role]) => `  --q-${name}: ${resolve([themes[theme], themes.shared], role)};`,
    );
  const geo = geometry(tokens);
  const geoLines = Object.entries(GEOMETRY_TOKENS).map(
    ([name, token]) => `  --q-${name}: ${resolveToken(geo.root, `var(${token})`)};`,
  );
  const fontLines = fontsFromQuiltor
    ? Object.entries(FONT_TOKENS).map(
        ([name, token]) => `  --q-${name}: ${resolveToken(geo.root, `var(${token})`)};`,
      )
    : [];
  const touchControl = resolveToken(geo.root, geo.touch.get("--control-regular") ?? "");
  if (!touchControl) throw new Error("tokens.css: touch override sets no --control-regular");

  return [
    "/* Generated by tools/design/export-keycloak-tokens.mjs from packages/client/src/design.",
    "   Do not edit. Regenerate in Quiltor and copy to the Keycloak theme. */",
    "",
    ":root {",
    "  color-scheme: light dark;",
    ...block("light"),
    ...geoLines,
    ...fontLines,
    "}",
    "",
    "@media (prefers-color-scheme: dark) {",
    "  :root {",
    ...block("dark").map((line) => `  ${line}`),
    "  }",
    "}",
    "",
    "@media (max-width: 719px), (pointer: coarse) {",
    "  :root {",
    `    --q-control-regular: ${touchControl};`,
    "  }",
    "}",
    "",
  ].join("\n");
}

export function readSources(dir = designRoot) {
  return {
    colors: readFileSync(join(dir, "colors.css"), "utf8"),
    tokens: readFileSync(join(dir, "tokens.css"), "utf8"),
  };
}

function main(argv) {
  const check = argv.includes("--check");
  const fontsFromQuiltor = argv.includes("--fonts-from-quiltor");
  const css = buildKeycloakTokens({ ...readSources(), fontsFromQuiltor });
  if (!check) {
    writeFileSync(OUTPUT, css);
    console.log(`wrote ${OUTPUT}`);
    return 0;
  }
  let current = "";
  try {
    current = readFileSync(OUTPUT, "utf8");
  } catch {
    // reported below
  }
  if (current.replaceAll("\r\n", "\n") === css) return 0;
  console.error(
    "distribution/keycloak/quiltor-tokens.css is stale: a design token changed.\n" +
      "Run `node tools/design/export-keycloak-tokens.mjs` and copy the file to\n" +
      "data/keycloak/themes/quiltor/login/resources/css/quiltor-tokens.css in the infrastructure repository.",
  );
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}
