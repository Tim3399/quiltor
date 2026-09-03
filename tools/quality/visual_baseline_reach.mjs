import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const SPEC = "tests/e2e/visual-baseline.spec.ts";
const SNAPSHOTS = "tests/e2e/visual-baseline.spec.ts-snapshots";
const WORKFLOWS = ".github/workflows";

/** GitHub runner labels mapped to the platform name Node reports. */
const NEWLINE = String.fromCharCode(10);

const RUNNER_PLATFORMS = Object.freeze({ macos: "darwin", ubuntu: "linux", windows: "win32" });

/** The platform a `test.skip(process.platform !== "x", …)` guard pins the suite to. */
export function pinnedPlatform(source) {
  return source.match(/process\.platform\s*!==\s*["'](\w+)["']/u)?.[1];
}

/** Job blocks of a workflow, keyed by nothing -- only their text is needed here. */
function jobBlocks(source) {
  const lines = source.split(NEWLINE);
  const starts = [];
  lines.forEach((line, index) => {
    if (/^ {2}[\w-]+:\s*$/u.test(line)) starts.push(index);
  });
  return starts.map((start, position) =>
    lines.slice(start, starts[position + 1] ?? lines.length).join(NEWLINE),
  );
}

/**
 * Every platform a job that actually runs the browser suite sits on.
 *
 * Asking which platforms the repository uses at all is the wrong question: a macOS runner
 * that only signs a release build never compares a single pixel.
 */
export function suitePlatforms(files) {
  const platforms = new Set();
  for (const source of files) {
    for (const block of jobBlocks(source)) {
      if (!/playwright test|test:e2e/u.test(block)) continue;
      const runner = block.match(/runs-on:\s*\[?\s*["']?([a-z]+)-/u)?.[1];
      const platform = runner && RUNNER_PLATFORMS[runner];
      if (platform) platforms.add(platform);
    }
  }
  return platforms;
}

/**
 * A gate that runs nowhere is not a gate.
 *
 * The pixel baselines are pinned to one rendering engine on purpose -- fonts differ between
 * platforms and a shared baseline would be noise. That is only a decision as long as some
 * job actually runs on that platform. Otherwise the suite reports green everywhere while
 * comparing nothing, and the checked-in images quietly rot.
 */
export function checkVisualBaselineReach(repositoryRoot) {
  const violations = [];
  const specPath = resolve(repositoryRoot, SPEC);
  if (!existsSync(specPath)) return violations;

  const platform = pinnedPlatform(readFileSync(specPath, "utf8"));
  if (!platform) return violations;

  const workflowDirectory = resolve(repositoryRoot, WORKFLOWS);
  if (!existsSync(workflowDirectory)) return violations;
  const files = readdirSync(workflowDirectory)
    .filter((name) => /\.ya?ml$/u.test(name))
    .map((name) => readFileSync(resolve(workflowDirectory, name), "utf8"));

  const platforms = suitePlatforms(files);
  if (!platforms.has(platform)) {
    violations.push(
      `${SPEC} vergleicht nur auf "${platform}", aber kein Job, der die Suite ausfuehrt, ` +
        `laeuft dort (gefunden: ${[...platforms].sort().join(", ") || "keiner"}). ` +
        `Die Baselines werden damit nirgends verglichen.`,
    );
  }

  const snapshotDirectory = resolve(repositoryRoot, SNAPSHOTS);
  if (existsSync(snapshotDirectory)) {
    const images = readdirSync(snapshotDirectory).filter((name) => name.endsWith(".png"));
    const matching = images.filter((name) => name.includes(`-${platform}.`));
    if (images.length && !matching.length) {
      violations.push(
        `${SNAPSHOTS} enthaelt ${images.length} Bilder, aber keines fuer "${platform}".`,
      );
    }
  }

  return violations;
}

export function formatVisualBaselineReport(violations) {
  return violations.length
    ? `Visual-Baseline-Reichweite fehlgeschlagen:\n${violations.map((line) => `- ${line}`).join("\n")}`
    : "Visual-Baseline-Reichweite haelt.";
}
