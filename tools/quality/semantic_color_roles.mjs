import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const productRoots = [
  ["packages", "client", "src", "app"],
  ["packages", "client", "src", "modules"],
  ["packages", "client", "src", "shared"],
];
const styleSourceExtensions = new Set([".css", ".ts", ".tsx"]);

const legacyFocusRoles = new Set(["--focus", "--focus-soft", "--focus-text", "--focus-border"]);
const paletteFamilies = ["--gold", "--rose", "--moss", "--ink-blue", "--copper"];

/**
 * Palette families are valid as data encodings inside graph visualisations, but not as component
 * state colors. Keeping the exception at selector + token granularity prevents an allowed file from
 * becoming a blanket escape hatch for future selected, focus or status styles.
 */
export const directPaletteRoleAllowlist = Object.freeze([
  {
    path: "packages/client/src/modules/story-world/StoryGraph.css",
    selector: ".story-node strong svg",
    variables: ["--rose-text"],
    rationale: "Deceased figure domain encoding",
  },
  {
    path: "packages/client/src/modules/story-world/StoryGraph.css",
    selector: ".react-flow__handle",
    variables: ["--gold"],
    rationale: "Directed graph connection encoding",
  },
  {
    path: "packages/client/src/modules/story-world/StoryGraph.css",
    selector: ".story-node .importance-mark",
    variables: ["--gold"],
    rationale: "Important-node graph encoding",
  },
  {
    path: "packages/client/src/modules/story-world/figures/FigureCanvas.css",
    selector: ".figure-workspace .flow-area .react-flow__connection-path",
    variables: ["--gold"],
    rationale: "Directed connection preview encoding",
  },
  {
    path: "packages/client/src/modules/story-world/figures/FigureCanvas.css",
    selector: ".figure-workspace .story-node .directed-handle",
    variables: ["--gold"],
    rationale: "Directed connection handle encoding",
  },
  {
    path: "packages/client/src/modules/story-world/figures/FigureCanvas.css",
    selector: ".figure-workspace .story-node .neutral-handle",
    variables: ["--moss"],
    rationale: "Undirected connection handle encoding",
  },
  {
    path: "packages/client/src/modules/story-world/figures/FigureCanvas.css",
    selector: ".figure-workspace .react-flow__edge.journey-edge .react-flow__edge-path",
    variables: ["--gold"],
    rationale: "Journey edge encoding",
  },
  {
    path: "packages/client/src/modules/story-world/figures/FigureCanvas.css",
    selector: ".figure-workspace .react-flow__edge.presence-edge .react-flow__edge-path",
    variables: ["--moss"],
    rationale: "Presence edge encoding",
  },
  {
    path: "packages/client/src/modules/story-world/figures/FigureCanvas.css",
    selector: ".figure-workspace .node-guests",
    variables: ["--moss-text"],
    rationale: "Present-at-location label encoding",
  },
  {
    path: "packages/client/src/modules/story-world/places/PlaceMeasurementOverlay.css",
    selector: ".places-workspace .distance-edge .react-flow__edge-path",
    variables: ["--gold"],
    rationale: "Distance measurement edge encoding",
  },
]);

function normalizePath(path) {
  return path.replaceAll("\\", "/");
}

function normalizeSelector(selector) {
  return selector
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

function selectorAt(source, index) {
  const blockOpen = source.lastIndexOf("{", index);

  if (blockOpen < 0) {
    return "<outside-rule>";
  }

  const previousDelimiter = Math.max(
    source.lastIndexOf("{", blockOpen - 1),
    source.lastIndexOf("}", blockOpen - 1),
  );

  return normalizeSelector(source.slice(previousDelimiter + 1, blockOpen));
}

function isDirectPaletteRole(name) {
  return (
    legacyFocusRoles.has(name) ||
    paletteFamilies.some((family) => name === family || name.startsWith(`${family}-`))
  );
}

function isAllowed(path, selector, variable, allowlist) {
  return allowlist.some(
    (entry) =>
      entry.path === path &&
      normalizeSelector(entry.selector) === selector &&
      entry.variables.includes(variable),
  );
}

export function scanSemanticColorRoleSource(path, source, allowlist = directPaletteRoleAllowlist) {
  const normalizedPath = normalizePath(path);
  const sanitized = withoutComments(source);
  const violations = [];
  const usage = /var\(\s*(--[\w-]+)/g;

  for (const match of sanitized.matchAll(usage)) {
    const variable = match[1];

    if (!isDirectPaletteRole(variable)) {
      continue;
    }

    const selector = selectorAt(sanitized, match.index);

    if (isAllowed(normalizedPath, selector, variable, allowlist)) {
      continue;
    }

    violations.push({
      path: normalizedPath,
      line: sanitized.slice(0, match.index).split("\n").length,
      selector,
      variable,
    });
  }

  return violations;
}

function visitStyleSources(path, onFile) {
  if (!existsSync(path)) {
    return;
  }

  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path)) {
      visitStyleSources(join(path, name), onFile);
    }

    return;
  }

  if (styleSourceExtensions.has(extname(path))) {
    onFile(path);
  }
}

export function scanSemanticColorRoles(root) {
  const violations = [];

  for (const segments of productRoots) {
    visitStyleSources(join(root, ...segments), (path) => {
      violations.push(
        ...scanSemanticColorRoleSource(relative(root, path), readFileSync(path, "utf8")),
      );
    });
  }

  return violations;
}

export function formatSemanticColorRoleViolation({ path, line, selector, variable }) {
  return `${path}:${line}: [Semantische Farbrolle] ${variable} in ${selector}`;
}
