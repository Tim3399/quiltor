// Shared manifest access for the layout audit's .mjs tools (ai-review, report). Mirrors the
// types in tests/audit/support/types.ts; change both together.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * @typedef {"mobile" | "tablet" | "desktop"} ViewportName
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 * @typedef {{ source: "rules" | "ai", rule: string, severity: "high" | "medium" | "low",
 *   message: string, selector?: string, rect?: Rect }} Finding
 * @typedef {{ id: string, state: string,
 *   kind: "view" | "overlay" | "dialog" | "menu" | "submenu" | "context-menu" | "popover",
 *   viewport: ViewportName, theme: "light" | "dark", screenshot: string, trigger?: string,
 *   viewportSpecific?: boolean, components?: string[], findings: Finding[] }} Entry
 * @typedef {{ generatedAt: string, commit: string,
 *   viewports: Record<ViewportName, { width: number, height: number, touch: boolean }>,
 *   entries: Entry[],
 *   coverage: { component: string, file: string, reached: boolean, evidence?: string, exception?: string }[],
 *   findings: Finding[],
 *   failures: { state: string, viewport: ViewportName, theme: string, error: string }[],
 *   aiReview?: { status: "done" | "skipped" | "partial", model?: string, reviewed?: number } }} Manifest
 */

export const DEFAULT_AUDIT_DIR = "test-results/layout-audit";
export const MANIFEST_FILE = "manifest.json";

/** @param {string} auditDir @returns {Manifest} */
export function readManifest(auditDir) {
  return JSON.parse(readFileSync(join(auditDir, MANIFEST_FILE), "utf8"));
}

/** @param {string} auditDir @param {Manifest} manifest */
export function writeManifest(auditDir, manifest) {
  writeFileSync(join(auditDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
}
