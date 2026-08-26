import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import {
  formatScrollbarOwnershipViolation,
  scanScrollbarOwnership,
} from "./scrollbar_ownership.mjs";
import {
  formatSemanticColorRoleViolation,
  scanSemanticColorRoles,
} from "./semantic_color_roles.mjs";

const root = process.cwd();
const clientRoot = join(root, "packages", "client", "src");
const webRoot = join(root, "apps", "web");
const designRoot = join(clientRoot, "design");
const designPath = relative(root, designRoot).replaceAll("\\", "/");

const rawValueAuthorities = new Set([
  join(designRoot, "colors.css"),
  join(designRoot, "tokens.css"),
]);

const extensions = new Set([".css", ".html", ".ts", ".tsx"]);

const ignored = new Set([
  "node_modules",
  "dist",
  "data",
  "test-results",
  "playwright-report",
  ".git",
  ".claude",
  ".venv-desktop",
  "build",
]);

const color =
  /#[\da-f]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(|:\s*(?:white|black|transparent)(?=\s*[;}])/gi;

// Property-scoped, not value-scoped: unlike color literals (unambiguous syntax anywhere), raw
// px/em numbers are common outside the 5 tokenized categories, so each check requires the
// property name immediately before the number. This keeps width/top/border-width/grid-template-*
// (deliberately out of scope — structural/layout, not shared design decisions) from ever matching.
//
// 1px/-1px/-3px are exempt everywhere: hairline borders and optical-centering nudges, not spacing
// choices. 50%-based radii (circles) are exempt too — a legitimate escape hatch, not a scale value.
const hairline = new Set(["1px", "-1px", "-3px"]);
const numberToken = /-?\d+(?:\.\d+)?(?:px|em)\b/g;

const propertyChecks = [
  [
    "Abstand",
    /\b(?:padding|margin)(?:-(?:top|bottom|left|right|inline|block))?\s*:\s*([^;{}]+)/gi,
    true,
  ],
  ["Abstand", /\b(?:gap|row-gap|column-gap)\s*:\s*([^;{}]+)/gi, true],
  ["Rundung", /\bborder-radius\s*:\s*([^;{}]+)/gi, false],
  ["Schatten", /\bbox-shadow\s*:\s*([^;{}]+)/gi, false],
  ["Schriftgröße", /\bfont(?:-size)?\s*:\s*([^;{}]+)/gi, false],
];

const zIndex = /\bz-index\s*:\s*(-?\d+)\b/gi;
const motion = /\b(?:animation(?:-duration)?|transition(?:-duration)?)\s*:\s*([^;{}]+)/gi;
const blur = /\b(?:backdrop-filter|filter)\s*:\s*([^;{}]*\bblur\([^;{}]+)/gi;

const violations = [];

// A var() pointing at a name nobody defines is invalid at computed-value time, so the property
// silently falls back to its initial value -- a transparent background, no shadow. That failure mode
// is invisible in review and survived a token rename here once already (--selection ->
// --selection-surface). Definitions are collected across every scanned file first, because they also
// come from inline style objects in .tsx ({ '--hold-progress': progress }), not just CSS blocks.
const definedCustomProperties = new Set();
const customPropertyUses = [];

const definition = /(--[\w-]+)\s*['"]?\s*:/g;
const usage = /var\(\s*(--[\w-]+)/g;

function collectCustomProperties(path, line, index) {
  definition.lastIndex = 0;

  for (const match of line.matchAll(definition)) {
    definedCustomProperties.add(match[1]);
  }

  usage.lastIndex = 0;

  for (const match of line.matchAll(usage)) {
    customPropertyUses.push([path, index + 1, match[1]]);
  }
}

function braceDelta(line) {
  const opens = (line.match(/{/g) || []).length;
  const closes = (line.match(/}/g) || []).length;

  return opens - closes;
}

function visit(path) {
  if (ignored.has(path.split(/[/\\]/).at(-1))) {
    return;
  }

  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path)) {
      visit(join(path, name));
    }

    return;
  }

  if (!extensions.has(extname(path))) {
    return;
  }

  const allowsRawValues = rawValueAuthorities.has(path);

  // Print layout is a separate rendering context (pt/in units, relative em
  // drop-cap sizing tied to print typography) and is deliberately outside the
  // app's screen-facing design token system.
  //
  // This has to track the complete CSS block instead of only checking whether
  // one line begins with "@media print" or "@page". A formatter may freely
  // expand a previously minified block across multiple lines.
  let ignoredDesignBlockDepth = 0;

  const lines = readFileSync(path, "utf8").split("\n");

  lines.forEach((line, index) => {
    collectCustomProperties(relative(root, path), line, index);

    if (allowsRawValues) {
      return;
    }

    const trimmed = line.trim();

    if (
      ignoredDesignBlockDepth === 0 &&
      (/^@media\s+print\b/.test(trimmed) || /^@page\b/.test(trimmed))
    ) {
      ignoredDesignBlockDepth = braceDelta(line);

      // Handles a complete one-line block such as:
      // @page { size: 6in 9in; }
      if (ignoredDesignBlockDepth <= 0) {
        ignoredDesignBlockDepth = 0;
      }

      return;
    }

    if (ignoredDesignBlockDepth > 0) {
      ignoredDesignBlockDepth += braceDelta(line);

      if (ignoredDesignBlockDepth <= 0) {
        ignoredDesignBlockDepth = 0;
      }

      return;
    }

    const colorMatches = line.match(color);

    if (colorMatches) {
      violations.push(`${relative(root, path)}:${index + 1}: [Farbe] ${colorMatches.join(", ")}`);
    }

    for (const [label, regex, exemptHairline] of propertyChecks) {
      regex.lastIndex = 0;

      for (const match of line.matchAll(regex)) {
        const numbers = (match[1].match(numberToken) || []).filter(
          (number) => !(exemptHairline && hairline.has(number)),
        );

        if (numbers.length) {
          violations.push(`${relative(root, path)}:${index + 1}: [${label}] ${numbers.join(", ")}`);
        }
      }
    }

    zIndex.lastIndex = 0;

    const zMatches = line.match(zIndex);

    if (zMatches) {
      violations.push(`${relative(root, path)}:${index + 1}: [z-index] ${zMatches.join(", ")}`);
    }

    motion.lastIndex = 0;

    for (const motionMatch of line.matchAll(motion)) {
      const rawTimes = motionMatch[1].match(/\b\d+(?:\.\d+)?m?s\b/g) || [];

      if (rawTimes.length) {
        violations.push(`${relative(root, path)}:${index + 1}: [Animation] ${rawTimes.join(", ")}`);
      }
    }

    blur.lastIndex = 0;

    if (blur.test(line) && /blur\(\s*\d/.test(line)) {
      violations.push(`${relative(root, path)}:${index + 1}: [Blur] roher Blur-Wert`);
    }
  });
}

visit(clientRoot);
visit(webRoot);

try {
  for (const violation of scanScrollbarOwnership(root)) {
    violations.push(formatScrollbarOwnershipViolation(violation));
  }
} catch (error) {
  violations.push(`[Scrollbar-Owner] ${error instanceof Error ? error.message : String(error)}`);
}

try {
  for (const violation of scanSemanticColorRoles(root)) {
    violations.push(formatSemanticColorRoleViolation(violation));
  }
} catch (error) {
  violations.push(
    `[Semantische Farbrolle] ${error instanceof Error ? error.message : String(error)}`,
  );
}

// --xy-* belongs to @xyflow/react and is defined inside the library stylesheet,
// which is outside the scanned tree; overriding those variables is the
// documented way to theme the graph.
for (const [path, line, name] of customPropertyUses) {
  if (name.startsWith("--xy-") || definedCustomProperties.has(name)) {
    continue;
  }

  violations.push(`${path}:${line}: [Undefinierte Variable] var(${name})`);
}

const tokens = readFileSync(join(designRoot, "tokens.css"), "utf8");
const colors = readFileSync(join(designRoot, "colors.css"), "utf8");

function colorDeclarationsBySelector(source) {
  const themes = { light: new Map(), dark: new Map(), shared: new Map() };
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of source.matchAll(rule)) {
    const selector = match[1].replaceAll(/\/\*[\s\S]*?\*\//g, "").trim();
    const target =
      selector === ":root"
        ? themes.shared
        : selector.includes(':root[data-theme="dark"]')
          ? themes.dark
          : selector.includes(':root[data-theme="light"]')
            ? themes.light
            : undefined;
    if (!target) continue;
    for (const declaration of match[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      target.set(declaration[1], declaration[2].trim());
    }
  }
  return themes;
}

const colorThemes = colorDeclarationsBySelector(colors);

function resolveThemeColor(theme, name, seen = new Set()) {
  if (seen.has(name)) return { error: `zyklischer Alias bei ${name}` };
  const value = colorThemes[theme].get(name) ?? colorThemes.shared.get(name);
  if (!value) return { error: `${name} ist nicht definiert` };
  const alias = /^var\(\s*(--[\w-]+)\s*\)$/u.exec(value)?.[1];
  if (!alias) return { value };
  return resolveThemeColor(theme, alias, new Set([...seen, name]));
}

const requiredTokens = [
  "control-compact",
  "control-regular",
  "control-touch",
  "toolbar-compact",
  "toolbar-regular",
  "sidebar-min",
  "sidebar-ideal",
  "sidebar-max",
  "inspector-min",
  "inspector-ideal",
  "inspector-max",
  "popover-min",
  "popover-max",
  "sheet-max",
  "layout-gutter-compact",
  "layout-gutter-regular",
  "layout-gutter-wide",
  "motion-instant",
  "motion-fast",
  "motion-regular",
  "motion-slow",
  "ease-standard",
  "ease-emphasized",
  "blur-toolbar",
  "blur-popover",
  "blur-sheet",
];

const requiredColors = [
  "material-toolbar",
  "material-popover",
  "material-sheet",
  "selection-surface",
  "control-hover",
  "disabled-surface",
  "disabled-content",
];

const chromaticFamilies = ["gold", "rose", "moss", "ink-blue", "copper"];
const chromaticRoles = ["", "-soft", "-text", "-border"];

const semanticColorRoles = {
  "--accent-primary": "--gold",
  "--accent-primary-soft": "--gold-soft",
  "--accent-primary-text": "--gold-text",
  "--accent-primary-border": "--gold-border",
  "--focus-ring": "--ink-blue",
  "--focus-surface": "--ink-blue-soft",
  "--link": "--ink-blue-text",
  "--link-hover": "--ink-blue",
  "--link-visited": "--ink-blue-text",
  "--success-bg": "--moss-soft",
  "--success-border": "--moss-border",
  "--success-text": "--moss-text",
  "--success-icon": "--moss",
  "--info-bg": "--ink-blue-soft",
  "--info-border": "--ink-blue-border",
  "--info-text": "--ink-blue-text",
  "--info-icon": "--ink-blue",
  "--warning-bg": "--copper-soft",
  "--warning-border": "--copper-border",
  "--warning-text": "--copper-text",
  "--warning-icon": "--copper",
  "--error-bg": "--rose-soft",
  "--error-border": "--rose-border",
  "--error-text": "--rose-text",
  "--error-icon": "--rose",
  "--danger": "--rose-text",
  "--danger-fill": "--rose-fill",
  "--selection-border": "--gold-border",
  "--drop-target-surface": "--ink-blue-soft",
  "--drop-target-border": "--ink-blue-border",
  "--drop-target-text": "--ink-blue-text",
  "--annotation-bg": "--gold-soft",
  "--annotation-border": "--gold-border",
  "--annotation-text": "--gold-text",
  "--search-match-bg": "--gold-soft",
  "--search-match-border": "--gold-border",
  "--search-match-active": "--gold",
};

for (const name of requiredTokens) {
  if (!tokens.includes(`--${name}:`)) {
    violations.push(`${designPath}/tokens.css: [Pflicht-Token] --${name}`);
  }
}

for (const family of chromaticFamilies) {
  for (const suffix of chromaticRoles) requiredColors.push(`${family}${suffix}`);
}

for (const name of requiredColors) {
  for (const theme of ["light", "dark"]) {
    const resolved = resolveThemeColor(theme, `--${name}`);
    if (resolved.error) {
      violations.push(
        `${designPath}/colors.css: [Theme-Parität] ${theme} --${name}: ${resolved.error}`,
      );
    }
  }
}

for (const [role, expectedFamilyRole] of Object.entries(semanticColorRoles)) {
  const actual = colorThemes.shared.get(role);
  if (actual !== `var(${expectedFamilyRole})`) {
    violations.push(
      `${designPath}/colors.css: [Semantische Farbrolle] ${role} muss var(${expectedFamilyRole}) sein, ist aber ${actual ?? "nicht definiert"}`,
    );
  }
}

const touchSize = tokens.match(/--control-touch:\s*(\d+)px/);

if (!touchSize || Number(touchSize[1]) < 44) {
  violations.push(
    `${designPath}/tokens.css: [Touchziel] --control-touch muss mindestens 44px betragen`,
  );
}

if (violations.length) {
  console.error(
    `Farb- und Gestaltungswerte gehören ausschließlich in ${designPath}/colors.css bzw. ${designPath}/tokens.css:\n${violations.join("\n")}`,
  );

  process.exit(1);
}
