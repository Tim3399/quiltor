import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const SPEC = "tests/e2e/visual-baseline.spec.ts";
const SNAPSHOTS = "tests/e2e/visual-baseline.spec.ts-snapshots";
const WORKFLOWS = ".github/workflows";

/** GitHub runner labels mapped to the platform name Node reports. */
const NEWLINE = String.fromCharCode(10);

const RUNNER_PLATFORMS = Object.freeze({ macos: "darwin", ubuntu: "linux", windows: "win32" });

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
 * Pixel baselines are versioned per platform, because font rasterisation differs. That only
 * guards anything while every platform running the suite actually has a set: a job without
 * baselines skips its comparison, and the suite reports green while comparing nothing. This
 * check names the platforms that still owe a set.
 */
export function checkVisualBaselineReach(repositoryRoot) {
  const violations = [];
  const specPath = resolve(repositoryRoot, SPEC);
  const workflowDirectory = resolve(repositoryRoot, WORKFLOWS);
  if (!existsSync(specPath) || !existsSync(workflowDirectory)) return violations;

  const files = readdirSync(workflowDirectory)
    .filter((name) => /\.ya?ml$/u.test(name))
    .map((name) => readFileSync(resolve(workflowDirectory, name), "utf8"));
  const platforms = [...suitePlatforms(files)].sort();

  const snapshotDirectory = resolve(repositoryRoot, SNAPSHOTS);
  const images = existsSync(snapshotDirectory)
    ? readdirSync(snapshotDirectory).filter((name) => name.endsWith(".png"))
    : [];

  if (!platforms.length) {
    violations.push(`Kein Job fuehrt ${SPEC} aus; die Baselines werden nirgends verglichen.`);
    return violations;
  }

  for (const platform of platforms) {
    if (!images.some((name) => name.includes(`-${platform}.`))) {
      violations.push(
        `${platform}: ein Job vergleicht dort, aber ${SNAPSHOTS} enthaelt keinen Satz. ` +
          "Einmal mit --update-snapshots erzeugen und einchecken.",
      );
    }
  }

  return violations;
}

export function formatVisualBaselineReport(violations) {
  return violations.length
    ? ["Visual-Baseline-Reichweite fehlgeschlagen:", ...violations.map((line) => `- ${line}`)].join(
        NEWLINE,
      )
    : "Visual-Baseline-Reichweite haelt.";
}
