// Shapes shared by the capture side (recorder.ts) and the merge side (merge.ts). Kept free of
// Playwright and layout-rules imports so merge.ts also runs under plain `node`.
import type { CoverageMapEntry } from "./coverage-map.ts";
import {
  AUDIT_DIR,
  type Entry,
  type Failure,
  type Finding,
  type ThemeName,
  type ViewportName,
} from "./types.ts";

export const PARTS_DIR = `${AUDIT_DIR}/parts`;

export type ManifestPart = {
  /** Run stamp from the global setup; the teardown merges only parts of the current run. */
  run: string;
  project: string;
  scenario: string;
  viewport: ViewportName;
  theme: ThemeName;
  entries: Entry[];
  findings: Finding[];
  failures: Failure[];
  /** Coverage keys whose evidence was observed, with the first state that showed it. */
  observed: Record<string, string>;
};

/** One line of an aria snapshot: role, accessible name and the trailing markers like [pressed]. */
export type AriaNode = { role: string; name: string; markers: string };

/** Parses `locator.ariaSnapshot()` output into the role/name pairs it lists. */
export function parseAriaSnapshot(snapshot: string): AriaNode[] {
  const nodes: AriaNode[] = [];
  for (const line of snapshot.split("\n")) {
    // YAML wraps a line in single quotes when the name contains ": ".
    const match = /^\s*- '?([a-z]+)(?: "((?:[^"\\]|\\.)*)")?(.*)$/.exec(line.replace(/''/g, "'"));
    if (!match) continue;
    nodes.push({
      role: match[1],
      name: (match[2] ?? "").replace(/\\(.)/g, "$1"),
      markers: match[3] ?? "",
    });
  }
  return nodes;
}

export function evidenceMatches(entry: CoverageMapEntry, nodes: AriaNode[]): boolean {
  const { role, name, marker } = entry.evidence;
  const roles = Array.isArray(role) ? role : [role];
  return nodes.some(
    (node) =>
      roles.includes(node.role) &&
      (typeof name === "string" ? node.name === name : name.test(node.name)) &&
      (!marker || node.markers.includes(marker)),
  );
}

export function coverageKey(entry: { component: string; file: string }): string {
  return `${entry.file}#${entry.component}`;
}
