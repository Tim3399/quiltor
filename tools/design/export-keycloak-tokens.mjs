import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/*
 * Exports the Quiltor design tokens for the Keycloak theme "quiltor" (T-175).
 *
 *   node tools/design/export-keycloak-tokens.mjs           write distribution/keycloak/quiltor-tokens.css
 *   node tools/design/export-keycloak-tokens.mjs --check   fail when that file is stale
 *   node tools/design/export-keycloak-tokens.mjs --lint <theme css> --tokens <file> [--tokens <file>]
 *       literal and role check of the theme CSS against the token files it loads
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
  // T-175-r2: the sign-in page (PageState) and the controls of option A
  "font-size-page-title": "--font-size-page-title-compact",
  "font-size-5": "--font-size-5",
  "ring-1": "--ring-1",
  "ring-2": "--ring-2",
  "elevation-2": "--elevation-2",
  "sheet-max": "--sheet-max",
  "spacing-panel-padding": "--spacing-panel-padding",
  "spacing-section-base": "--spacing-section-base",
  "spacing-field-stack": "--spacing-field-stack",
  "spacing-field-group": "--spacing-field-group",
  "spacing-compact-wide": "--spacing-compact-wide",
  "motion-fast": "--motion-fast",
  "motion-quick": "--motion-quick",
  "ease-standard": "--ease-standard",
});

/*
 * Component roles (T-175-r2). Each role is the value a Quiltor component sets on one
 * property, resolved per theme. When a component changes the role it uses (say the primary
 * button turns from --ink to --soft), the export changes and the check goes red -- copying
 * the palette alone could not notice that.
 *
 * file is relative to packages/client/src/design (or src/ for modules), selector must match
 * a rule exactly, and part picks one var() out of a shorthand ("1px solid var(--line)").
 */
export const COMPONENT_ROLES = Object.freeze([
  // the sign-in page right before Keycloak (SignInGate -> PageState)
  ["page-bg", "components/PageState/PageState.css", ".page-state", "background"],
  ["page-text", "components/PageState/PageState.css", ".page-state", "color"],
  ["page-padding", "components/PageState/PageState.css", ".page-state", "padding"],
  ["mark-size", "components/PageState/PageState.css", ".page-state__mark", "width"],
  ["mark-bg", "components/PageState/PageState.css", ".page-state__mark", "background"],
  ["mark-border", "components/PageState/PageState.css", ".page-state__mark", "border", 0],
  ["mark-radius", "components/PageState/PageState.css", ".page-state__mark", "border-radius"],
  ["mark-shadow", "components/PageState/PageState.css", ".page-state__mark", "box-shadow"],
  ["title-color", "components/PageState/PageState.css", ".page-state h1", "color"],
  ["title-margin", "components/PageState/PageState.css", ".page-state h1", "margin"],
  [
    "actions-margin-top",
    "components/PageState/PageState.css",
    ".page-state__actions",
    "margin-top",
  ],
  ["copy-max", "components/PageState/PageState.css", ".page-state__copy", "max-width"],
  ["actions-gap", "components/PageState/PageState.css", ".page-state__actions", "gap"],
  // the panel card of the world gate, used for the form
  ["panel-bg", "../modules/story-world/worlds/WorldGate.css", ".world-list-panel", "background"],
  ["panel-border", "../modules/story-world/worlds/WorldGate.css", ".world-list-panel", "border", 0],
  [
    "panel-radius",
    "../modules/story-world/worlds/WorldGate.css",
    ".world-list-panel",
    "border-radius",
  ],
  [
    "panel-shadow",
    "../modules/story-world/worlds/WorldGate.css",
    ".world-list-panel",
    "box-shadow",
  ],
  ["panel-padding", "../modules/story-world/worlds/WorldGate.css", ".world-list-panel", "padding"],
  // buttons
  ["btn-height", "primitives/Button/Button.css", ".ui-button", "min-height"],
  ["btn-padding-inline", "primitives/Button/Button.css", ".ui-button", "padding", 0],
  ["btn-radius", "primitives/Button/Button.css", ".ui-button", "border-radius"],
  ["btn-gap", "primitives/Button/Button.css", ".ui-button", "gap"],
  ["btn-hover-bg", "primitives/Button/Button.css", ".ui-button:hover:not(:disabled)", "background"],
  ["btn-focus", "primitives/Button/Button.css", ".ui-button:focus-visible", "outline", 0],
  [
    "btn-primary-bg",
    "primitives/Button/Button.css",
    ".ui-button--primary.ui-button--neutral",
    "background",
  ],
  [
    "btn-primary-border",
    "primitives/Button/Button.css",
    ".ui-button--primary.ui-button--neutral",
    "border-color",
  ],
  [
    "btn-primary-text",
    "primitives/Button/Button.css",
    ".ui-button--primary.ui-button--neutral",
    "color",
  ],
  [
    "btn-primary-hover-bg",
    "primitives/Button/Button.css",
    ".ui-button--primary.ui-button--neutral:hover:not(:disabled)",
    "background",
  ],
  [
    "btn-secondary-bg",
    "primitives/Button/Button.css",
    ".ui-button--secondary.ui-button--neutral",
    "background",
  ],
  [
    "btn-secondary-border",
    "primitives/Button/Button.css",
    ".ui-button--secondary.ui-button--neutral",
    "border-color",
  ],
  [
    "btn-secondary-text",
    "primitives/Button/Button.css",
    ".ui-button--secondary.ui-button--neutral",
    "color",
  ],
  [
    "btn-ghost-text",
    "primitives/Button/Button.css",
    ".ui-button--ghost.ui-button--neutral",
    "color",
  ],
  [
    "btn-disabled-bg",
    "primitives/Button/Button.css",
    '.ui-button[class*="ui-button--"]:disabled',
    "background",
  ],
  [
    "btn-disabled-text",
    "primitives/Button/Button.css",
    '.ui-button[class*="ui-button--"]:disabled',
    "color",
  ],
  [
    "btn-disabled-border",
    "primitives/Button/Button.css",
    '.ui-button[class*="ui-button--"]:disabled',
    "border-color",
  ],
  // fields
  ["field-label-text", "primitives/Field/Field.css", ".ui-field__label", "color"],
  [
    "field-bg",
    "primitives/Field/Field.css",
    ".ui-field > input,\n.ui-field > textarea,\n.ui-field > select",
    "background-color",
  ],
  [
    "field-text",
    "primitives/Field/Field.css",
    ".ui-field > input,\n.ui-field > textarea,\n.ui-field > select",
    "color",
  ],
  [
    "field-radius",
    "primitives/Field/Field.css",
    ".ui-field > input,\n.ui-field > textarea,\n.ui-field > select",
    "border-radius",
  ],
  [
    "field-shadow",
    "primitives/Field/Field.css",
    ".ui-field > input,\n.ui-field > textarea,\n.ui-field > select",
    "box-shadow",
  ],
  [
    "field-placeholder",
    "primitives/Field/Field.css",
    ".ui-field > input::placeholder,\n.ui-field > textarea::placeholder",
    "color",
  ],
  [
    "field-focus-border",
    "primitives/Field/Field.css",
    ".ui-field > input:focus-visible,\n.ui-field > textarea:focus-visible,\n.ui-field > select:focus-visible",
    "border-color",
  ],
  [
    "field-focus-shadow",
    "primitives/Field/Field.css",
    ".ui-field > input:focus-visible,\n.ui-field > textarea:focus-visible,\n.ui-field > select:focus-visible",
    "box-shadow",
  ],
  [
    "field-invalid-border",
    "primitives/Field/Field.css",
    '.ui-field[data-invalid="true"] > input,\n.ui-field[data-invalid="true"] > textarea,\n.ui-field[data-invalid="true"] > select',
    "border-color",
  ],
  // segmented control (language switch)
  ["seg-border", "primitives/SegmentedControl/SegmentedControl.css", ".ui-segmented", "border", 0],
  [
    "seg-radius",
    "primitives/SegmentedControl/SegmentedControl.css",
    ".ui-segmented",
    "border-radius",
  ],
  ["seg-bg", "primitives/SegmentedControl/SegmentedControl.css", ".ui-segmented", "background"],
  ["seg-padding", "primitives/SegmentedControl/SegmentedControl.css", ".ui-segmented", "padding"],
  ["seg-gap", "primitives/SegmentedControl/SegmentedControl.css", ".ui-segmented", "gap"],
  [
    "seg-item-text",
    "primitives/SegmentedControl/SegmentedControl.css",
    ".ui-segmented button",
    "color",
  ],
  [
    "seg-item-radius",
    "primitives/SegmentedControl/SegmentedControl.css",
    ".ui-segmented button",
    "border-radius",
  ],
  [
    "seg-item-padding",
    "primitives/SegmentedControl/SegmentedControl.css",
    ".ui-segmented button",
    "padding",
    0,
  ],
  [
    "seg-active-bg",
    "primitives/SegmentedControl/SegmentedControl.css",
    '.ui-segmented button[aria-checked="true"]',
    "background",
  ],
  [
    "seg-active-text",
    "primitives/SegmentedControl/SegmentedControl.css",
    '.ui-segmented button[aria-checked="true"]',
    "color",
  ],
  [
    "seg-active-shadow",
    "primitives/SegmentedControl/SegmentedControl.css",
    '.ui-segmented button[aria-checked="true"]',
    "box-shadow",
  ],
  // checkbox
  ["checkbox-size", "primitives/Checkbox/Checkbox.css", ".ui-checkbox__control", "width"],
  ["checkbox-accent", "primitives/Checkbox/Checkbox.css", ".ui-checkbox__control", "accent-color"],
  [
    "checkbox-focus-shadow",
    "primitives/Checkbox/Checkbox.css",
    ".ui-checkbox__control:focus-visible",
    "box-shadow",
  ],
]);

// Tokens that change with the viewport (touch override) stay live variables instead of a
// resolved number, so the theme keeps Quiltor's 44px controls on touch screens.
const LIVE_TOKENS = new Map([
  ["--control-regular", "var(--q-control-regular)"],
  ["--control-compact", "var(--q-control-regular)"],
]);

/** Plain declarations of one rule, found by its exact selector text. */
export function ruleDeclarations(source, selector) {
  const wanted = selector.replaceAll(/\s+/g, " ").trim();
  for (const match of stripComments(source).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].replaceAll(/\s+/g, " ").trim() !== wanted) continue;
    const map = new Map();
    for (const d of match[2].matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)) {
      map.set(d[1], d[2].trim().replaceAll(/\s+/g, " "));
    }
    return map;
  }
  return undefined;
}

/** Resolves every var() in a value against the theme colours and the tokens. */
function resolveExpression(value, maps, tokens, seen = new Set()) {
  return value.replaceAll(/var\(\s*(--[\w-]+)\s*\)/g, (_, name) => {
    if (LIVE_TOKENS.has(name)) return LIVE_TOKENS.get(name);
    if (seen.has(name)) throw new Error(`cyclic reference at ${name}`);
    const next = maps.map((m) => m.get(name)).find((v) => v !== undefined) ?? tokens.get(name);
    if (next === undefined) throw new Error(`${name} is not defined`);
    return resolveExpression(next, maps, tokens, new Set([...seen, name]));
  });
}

/** Light and dark value of every component role. */
export function componentRoles(components, themes, tokens) {
  return COMPONENT_ROLES.map(([name, file, selector, property, part]) => {
    const source = components[file];
    if (source === undefined) throw new Error(`${file}: not read`);
    const rule = ruleDeclarations(source, selector);
    if (!rule) throw new Error(`${file}: rule "${selector}" not found`);
    let value = rule.get(property);
    if (value === undefined) throw new Error(`${file}: "${selector}" sets no ${property}`);
    if (part !== undefined) {
      const vars = value.match(/var\(\s*--[\w-]+\s*\)/g) ?? [];
      if (!vars[part]) throw new Error(`${file}: "${selector}" ${property} has no var() #${part}`);
      value = vars[part];
    }
    const light = resolveExpression(value, [themes.light, themes.shared], tokens);
    const dark = resolveExpression(value, [themes.dark, themes.shared], tokens);
    return { name, light, dark };
  });
}

/*
 * Literal check for the theme CSS (T-175-r2 plan §7). Within the property scope below, a
 * value may only use var(--q-...) and the listed exceptions; everything else is a value the
 * theme invented instead of taking it from Quiltor.
 */
const SCOPE =
  /^(color|background(-color|-image)?|border(-(top|right|bottom|left))?(-color)?|outline(-color)?|accent-color|fill|font(-size)?|border(-[a-z]+)?-radius|box-shadow|height|min-height|max-height|width|min-width|max-width|padding(-[a-z]+)?|margin(-[a-z]+)?|gap|row-gap|column-gap|outline-offset|outline-width|border-width)$/;
const KEYWORDS =
  /\b(0|none|auto|inherit|initial|unset|transparent|currentColor|solid|inset|normal|fit-content|max-content|min-content)\b/g;

export function lintThemeCss(css, known) {
  const problems = [];
  const clean = css.replaceAll(/\/\*[\s\S]*?\*\//g, (c) => c.replaceAll(/[^\n]/g, " "));
  for (const rule of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1].trim();
    const qrCode = selector.includes("qr-code");
    const srOnly = /sr-only|kc-current-locale-link/.test(selector);
    // a declaration ends at ";" or at the end of the block (the last one needs no semicolon)
    for (const d of rule[2].matchAll(/(--[\w-]+|[a-z-]+)\s*:\s*([^;]+?)\s*(?:;|$)/g)) {
      const [property, raw] = [d[1], d[2].trim()];
      // the theme takes its roles from the generated files and defines none of its own
      if (property.startsWith("--q-")) {
        problems.push(
          `${selector.split("\n").pop().trim()} { ${property} } -> defines a --q-* role itself`,
        );
        continue;
      }
      // a role the token files do not define (renamed or dropped in Quiltor) falls back silently
      if (known) {
        for (const ref of raw.matchAll(/var\(\s*(--q-[\w-]+)/g)) {
          if (!known.has(ref[1]))
            problems.push(
              `${selector.split("\n").pop().trim()} { ${property}: ${raw} } -> unknown ${ref[1]}`,
            );
        }
      }
      if (!SCOPE.test(property)) continue;
      let rest = raw
        .replaceAll(/var\(\s*--q-[\w-]+\s*\)/g, " ")
        .replaceAll(/env\([^)]*\)/g, " ")
        // relative theme images and the gradient function itself; colours inside it still count
        .replaceAll(/url\(\s*["']?\.\.?\/[^)]*\)/g, " ")
        .replaceAll(/\b(linear|radial)-gradient\(/g, " (")
        .replaceAll(/\b(center|contain|cover|no-repeat)\b/g, " ")
        .replaceAll(/!important/g, " ")
        .replaceAll(KEYWORDS, " ")
        .replaceAll(/\b(calc|min|max|clamp)\(/g, " (")
        .replaceAll(/[(),*+/]/g, " ")
        .replaceAll(/\b100%/g, " ")
        // a full-height page: Quiltor gets it from html/body height 100%, Keycloak needs the viewport
        .replaceAll(/\b100d?vh\b/g, " ")
        .replaceAll(/\b50%/g, srOnly ? " " : "50%")
        .trim();
      const allowedPx =
        property.startsWith("border") && !property.endsWith("radius")
          ? ["1px"]
          : property.startsWith("outline") && property !== "outline-offset"
            ? ["2px"]
            : property === "outline-offset"
              ? ["1px", "2px"]
              : srOnly
                ? ["1px", "-1px"]
                : [];
      rest = rest
        .split(/\s+/)
        .filter(
          (t) => t && !allowedPx.includes(t) && !(qrCode && /^#fff(fff)?$/i.test(t)) && t !== "-",
        )
        .join(" ");
      if (rest)
        problems.push(`${selector.split("\n").pop().trim()} { ${property}: ${raw} } -> ${rest}`);
    }
  }
  return problems;
}

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

export function buildKeycloakTokens({ colors, tokens, components = {}, fontsFromQuiltor = false }) {
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
  const roles = Object.keys(components).length ? componentRoles(components, themes, geo.root) : [];
  const roleLight = roles.map((r) => `  --q-${r.name}: ${r.light};`);
  const roleDark = roles
    .filter((r) => r.dark !== r.light)
    .map((r) => `    --q-${r.name}: ${r.dark};`);
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
    ...(roleLight.length ? ["  /* component roles */", ...roleLight] : []),
    "}",
    "",
    "@media (prefers-color-scheme: dark) {",
    "  :root {",
    ...block("dark").map((line) => `  ${line}`),
    ...roleDark,
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
  const components = {};
  for (const [, file] of COMPONENT_ROLES) {
    components[file] ??= readFileSync(join(dir, file), "utf8");
  }
  return {
    colors: readFileSync(join(dir, "colors.css"), "utf8"),
    tokens: readFileSync(join(dir, "tokens.css"), "utf8"),
    components,
  };
}

function main(argv) {
  const lint = argv.indexOf("--lint");
  if (lint !== -1) {
    const file = argv[lint + 1];
    const known = new Set();
    argv.forEach((arg, i) => {
      if (arg !== "--tokens") return;
      for (const m of readFileSync(argv[i + 1], "utf8").matchAll(/(--q-[\w-]+)\s*:/g))
        known.add(m[1]);
    });
    if (!known.size) {
      console.error(
        "--lint needs the token files: --lint <css> --tokens quiltor-tokens.css --tokens quiltor-fonts.css",
      );
      return 2;
    }
    const problems = lintThemeCss(readFileSync(file, "utf8"), known);
    for (const problem of problems)
      console.error(`${file}: literal outside the exceptions: ${problem}`);
    return problems.length ? 1 : 0;
  }
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
