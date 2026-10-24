// Merges the partial manifests of one run into test-results/layout-audit/manifest.json and derives
// the coverage section from the static inventory, the coverage map and the evidence the capture
// tests actually observed. Runs as the audit config's global teardown; under plain node it
// re-merges the parts already on disk:
//
//   node tests/audit/support/merge.ts [--expect-reached <Component>]...
//
// --expect-reached exits 1 when a named component is not reached; the coverage-guard checks use
// it together with tools/dev/mutate.mjs.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeManifest } from "../../../tools/audit/manifest.mjs";
import { COVERAGE_MAP, type CoverageMapEntry } from "./coverage-map.ts";
import { coverageKey, type ManifestPart, PARTS_DIR } from "./parts.ts";
import {
  AUDIT_DIR,
  AUDIT_THEMES,
  AUDIT_VIEWPORTS,
  type CoverageRecord,
  type Entry,
  type Failure,
  type Finding,
  type Manifest,
  type ViewportName,
} from "./types.ts";

export type InventoryItem = { component: string; file: string; patterns: string[] };
export type CoverageException = { component: string; file: string; reason: string };

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
export const EXCEPTIONS_FILE = join(ROOT, "tests/audit/coverage-exceptions.json");

export async function loadInventory(root = ROOT): Promise<InventoryItem[]> {
  const module = (await import(pathToFileURL(join(root, "tools/audit/inventory.mjs")).href)) as {
    buildInventory: (rootDir?: string) => InventoryItem[] | Promise<InventoryItem[]>;
  };
  return await module.buildInventory(root);
}

export function loadExceptions(file = EXCEPTIONS_FILE): CoverageException[] {
  const data = JSON.parse(readFileSync(file, "utf8")) as { exceptions: CoverageException[] };
  return data.exceptions;
}

function readParts(dir: string): { file: string; part: ManifestPart }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({
      file: join(dir, name),
      part: JSON.parse(readFileSync(join(dir, name), "utf8")) as ManifestPart,
    }));
}

function describeEvidence(entry: CoverageMapEntry): string {
  const { role, name, marker } = entry.evidence;
  const roles = Array.isArray(role) ? role.join("|") : role;
  const label = typeof name === "string" ? JSON.stringify(name) : String(name);
  return `${roles} ${label}${marker ? ` ${marker}` : ""}`;
}

/**
 * Coverage per inventory component plus every view and overlay of the coverage map. A component
 * counts as reached only when its DOM evidence was observed in a captured state.
 */
export function computeCoverage(
  inventory: InventoryItem[],
  map: CoverageMapEntry[],
  observed: Map<string, string>,
  exceptions: CoverageException[],
): { coverage: CoverageRecord[]; findings: Finding[] } {
  const coverage: CoverageRecord[] = [];
  const findings: Finding[] = [];

  const record = (component: string, file: string, entry: CoverageMapEntry | undefined) => {
    const state = observed.get(coverageKey({ component, file }));
    const exception = exceptions.find((item) => item.component === component && item.file === file);
    const reached = entry !== undefined && state !== undefined;
    coverage.push({
      component,
      file,
      reached,
      ...(reached && entry ? { evidence: `${describeEvidence(entry)} in ${state}` } : {}),
      ...(exception ? { exception: exception.reason } : {}),
    });
    if (reached || exception) return;
    findings.push({
      source: "rules",
      rule: "coverage-unreached",
      severity: "high",
      message: entry
        ? `${component} (${file}) was not reached: its evidence ${describeEvidence(entry)} was never visible in a captured state.`
        : `${component} (${file}) renders a popup but has no entry in tests/audit/support/coverage-map.ts.`,
    });
  };

  for (const item of inventory) {
    record(
      item.component,
      item.file,
      map.find((entry) => entry.component === item.component && entry.file === item.file),
    );
  }
  const inventoried = new Set(inventory.map((item) => coverageKey(item)));
  for (const entry of map) {
    if (entry.category === "component" || inventoried.has(coverageKey(entry))) continue;
    record(entry.component, entry.file, entry);
  }
  coverage.sort((a, b) => a.file.localeCompare(b.file) || a.component.localeCompare(b.component));
  return { coverage, findings };
}

/**
 * Every state must exist in both themes and, unless marked viewportSpecific, in all three
 * viewports. A gap that no failure explains yet is recorded as a failure, so it is never silent.
 */
export function matrixGaps(entries: Entry[], failures: Failure[]): Failure[] {
  const viewports = Object.keys(AUDIT_VIEWPORTS) as ViewportName[];
  const byState = new Map<string, Entry[]>();
  for (const entry of entries) byState.set(entry.state, [...(byState.get(entry.state) ?? []), entry]);
  const explained = (state: string, viewport: string, theme: string) =>
    failures.some(
      (failure) =>
        failure.viewport === viewport &&
        failure.theme === theme &&
        (state === failure.state || state.startsWith(`${failure.state}/`)),
    );
  const gaps: Failure[] = [];
  for (const [state, list] of byState) {
    const specific = list.some((entry) => entry.viewportSpecific);
    const present = new Set(list.map((entry) => `${entry.viewport}/${entry.theme}`));
    const wanted = specific ? [...new Set(list.map((entry) => entry.viewport))] : viewports;
    for (const viewport of wanted) {
      for (const theme of AUDIT_THEMES) {
        if (present.has(`${viewport}/${theme}`) || explained(state, viewport, theme)) continue;
        gaps.push({
          state,
          viewport,
          theme,
          error: `State was captured in ${[...present].sort().join(", ")} but not in ${viewport}/${theme}.`,
        });
      }
    }
  }
  return gaps;
}

function currentCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** Merges the parts of `run` (all parts when omitted). Returns null when there are none. */
export async function mergeAuditParts(run?: string): Promise<Manifest | null> {
  const partsDir = join(ROOT, PARTS_DIR);
  const all = readParts(partsDir);
  const current = all.filter(({ part }) => run === undefined || part.run === run);
  if (current.length === 0) return null;

  const entries: Entry[] = [];
  const findings: Finding[] = [];
  const failures: Failure[] = [];
  const observed = new Map<string, string>();
  for (const { part } of current) {
    entries.push(...part.entries);
    findings.push(...part.findings);
    failures.push(...part.failures);
    for (const [key, state] of Object.entries(part.observed)) {
      if (!observed.has(key)) observed.set(key, `${state} (${part.viewport}/${part.theme})`);
    }
  }
  entries.sort((a, b) => a.id.localeCompare(b.id));
  failures.push(...matrixGaps(entries, failures));

  let inventory: InventoryItem[] = [];
  try {
    inventory = await loadInventory();
  } catch (error) {
    failures.push({
      state: "coverage/inventory",
      viewport: "desktop",
      theme: "-",
      error: `tools/audit/inventory.mjs could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  const coverage = computeCoverage(inventory, COVERAGE_MAP, observed, loadExceptions());
  findings.push(...coverage.findings);

  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    commit: currentCommit(),
    viewports: AUDIT_VIEWPORTS,
    entries,
    coverage: coverage.coverage,
    findings,
    failures,
  };
  writeManifest(join(ROOT, AUDIT_DIR), manifest);

  // Drop what older runs left behind: their parts and screenshots no entry refers to any more.
  if (run !== undefined) {
    for (const { file, part } of all) if (part.run !== run) rmSync(file, { force: true });
    const shotsDir = join(ROOT, AUDIT_DIR, "shots");
    const referenced = new Set(entries.map((entry) => entry.screenshot.replace(/^shots\//, "")));
    if (existsSync(shotsDir)) {
      for (const name of readdirSync(shotsDir)) {
        if (!referenced.has(name)) rmSync(join(shotsDir, name), { force: true });
      }
    }
  }
  return manifest;
}

export function summarize(manifest: Manifest): string {
  const count = (items: { [key: string]: unknown }[], key: string) => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(String(item[key]), (counts.get(String(item[key])) ?? 0) + 1);
    return [...counts].sort().map(([name, value]) => `${name}=${value}`).join(" ");
  };
  const states = new Set(manifest.entries.map((entry) => entry.state));
  const findings = [...manifest.findings, ...manifest.entries.flatMap((entry) => entry.findings)];
  const reached = manifest.coverage.filter((item) => item.reached).length;
  const excepted = manifest.coverage.filter((item) => !item.reached && item.exception).length;
  return [
    `Layout audit: ${manifest.entries.length} entries, ${states.size} states.`,
    `Entries by kind: ${count(manifest.entries, "kind")}`,
    `Coverage: ${reached} reached, ${excepted} excepted, ${manifest.coverage.length - reached - excepted} unreached of ${manifest.coverage.length}.`,
    `Findings by rule: ${count(findings, "rule") || "none"}`,
    `Findings by severity: ${count(findings, "severity") || "none"}`,
    `Failures: ${manifest.failures.length}`,
  ].join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const expected: string[] = [];
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--expect-reached" && args[index + 1]) expected.push(args[++index]);
  }
  const manifest = await mergeAuditParts();
  if (!manifest) {
    console.error(`No capture parts under ${PARTS_DIR}.`);
    process.exit(2);
  }
  console.log(summarize(manifest));
  for (const finding of manifest.findings.filter((item) => item.rule === "coverage-unreached")) {
    console.log(`coverage-unreached (${finding.severity}): ${finding.message}`);
  }
  let missing = false;
  for (const component of expected) {
    const record = manifest.coverage.find((item) => item.component === component);
    console.log(`${component}: ${record ? `reached=${record.reached}` : "not in coverage"}`);
    if (!record?.reached) missing = true;
  }
  process.exit(missing ? 1 : 0);
}
