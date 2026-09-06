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
function runnerLabels(block) {
  const value = block.match(/runs-on:\s*([^\n#]+)/u)?.[1]?.trim();
  if (!value) return [];
  const key = value.match(/^\$\{\{\s*matrix\.([a-z_][a-z0-9_]*)\s*\}\}$/u)?.[1];
  if (!key) return [value];
  // `runs-on: ${{ matrix.os }}` waere sonst kein lesbarer Runner -- und ein Job, dessen
  // Plattform diese Pruefung nicht liest, ist ein Job, dessen fehlende Bilder sie nicht
  // meldet. Genau die Luecke, die es hier zu schliessen gilt.
  const list = block.match(new RegExp(`\\n\\s*${key}:\\s*\\[([^\\]]*)\\]`, "u"))?.[1];
  return list ? list.split(",").map((entry) => entry.trim().replace(/^["']|["']$/gu, "")) : [];
}

export function suitePlatforms(files) {
  const platforms = new Set();
  for (const source of files) {
    for (const block of jobBlocks(source)) {
      if (!/playwright test|test:e2e/u.test(block)) continue;
      for (const label of runnerLabels(block)) {
        const platform = RUNNER_PLATFORMS[label.split("-")[0]];
        if (platform) platforms.add(platform);
      }
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

  // Nicht "irgendein Bild", sondern jedes: geloescht wird hier plattformweise, wenn sich ein
  // Design geaendert hat. Wer nur fragt, ob ueberhaupt ein Satz da ist, sagt "haelt", waehrend
  // eine Plattform die Haelfte ihrer Ansichten nicht mehr vergleicht -- und der Bootstrap-Lauf,
  // der genau daran haengt, ueberspringt sich selbst.
  const stems = new Map();
  for (const name of images) {
    const platform = platforms.find((candidate) => name.endsWith(`-${candidate}.png`));
    if (!platform) continue;
    const stem = name.slice(0, -`-${platform}.png`.length);
    stems.set(stem, (stems.get(stem) ?? new Set()).add(platform));
  }

  for (const platform of platforms) {
    const fehlend = [...stems]
      .filter(([, owners]) => !owners.has(platform))
      .map(([stem]) => stem)
      .sort();
    if (!images.some((name) => name.endsWith(`-${platform}.png`))) {
      violations.push(
        `${platform}: ein Job vergleicht dort, aber ${SNAPSHOTS} enthaelt keinen Satz. ` +
          'Den Workflow "Visual-Baselines erzeugen" einmal starten; er fuellt nur, was fehlt.',
      );
    } else if (fehlend.length) {
      violations.push(
        `${platform}: ${fehlend.length} Bild(er) fehlen gegenueber den anderen Plattformen ` +
          `(${fehlend.slice(0, 4).join(", ")}${fehlend.length > 4 ? ", ..." : ""}). ` +
          'Der Workflow "Visual-Baselines erzeugen" traegt sie nach.',
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
