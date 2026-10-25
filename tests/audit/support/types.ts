// Shared contract of the layout audit (T-1). Parts A-D depend on these shapes; change them
// only together with tools/audit/manifest.mjs, which mirrors them for the .mjs tools.

export type ViewportName = "mobile" | "tablet" | "desktop";
export type ThemeName = "light" | "dark";

export type Severity = "high" | "medium" | "low";

export type Rect = { x: number; y: number; width: number; height: number };

export type Finding = {
  source: "rules" | "ai";
  /** Rule id, or "ai:<category>" for AI findings. */
  rule: string;
  severity: Severity;
  /** English. */
  message: string;
  selector?: string;
  rect?: Rect;
};

export type EntryKind =
  | "view"
  | "overlay"
  | "dialog"
  | "menu"
  | "submenu"
  | "context-menu"
  | "popover";

export type Entry = {
  /** Stable: <state>--<viewport>--<theme>, see entryId(). */
  id: string;
  /** e.g. "workspace.text/menu.actions/submenu.more" */
  state: string;
  kind: EntryKind;
  viewport: ViewportName;
  theme: ThemeName;
  /** Relative to the audit directory, e.g. "shots/<id>.png". */
  screenshot: string;
  /** How the state was reached, e.g. "right-click", "long-press", "shift+f10". */
  trigger?: string;
  /** The state exists only in some viewports by design. */
  viewportSpecific?: boolean;
  /** Inventory names whose DOM evidence was observed in this state. */
  components?: string[];
  findings: Finding[];
};

export type CoverageRecord = {
  component: string;
  file: string;
  reached: boolean;
  evidence?: string;
  exception?: string;
};

export type Failure = {
  state: string;
  viewport: ViewportName;
  theme: string;
  error: string;
};

export type ViewportSpec = { width: number; height: number; touch: boolean };

export type Manifest = {
  generatedAt: string;
  commit: string;
  viewports: Record<ViewportName, ViewportSpec>;
  entries: Entry[];
  coverage: CoverageRecord[];
  /** Findings without a screenshot (coverage-unreached, touch-context-menu-unverified), written by part A. */
  findings: Finding[];
  failures: Failure[];
  aiReview?: { status: "done" | "skipped" | "partial"; model?: string; reviewed?: number };
};

export type LayoutContext = { viewport: ViewportName; touch: boolean; popupSelector?: string };

export const AUDIT_VIEWPORTS: Record<ViewportName, ViewportSpec> = {
  mobile: { width: 390, height: 844, touch: true },
  tablet: { width: 820, height: 1180, touch: true },
  desktop: { width: 1440, height: 900, touch: false },
};

export const AUDIT_THEMES: readonly ThemeName[] = ["light", "dark"];

/** Output directory, relative to the repository root. Already gitignored via test-results/. */
export const AUDIT_DIR = "test-results/layout-audit";

export function entryId(state: string, viewport: ViewportName, theme: ThemeName): string {
  return `${state}--${viewport}--${theme}`;
}

/** File-system safe screenshot path for an entry id, relative to AUDIT_DIR. */
export function screenshotPath(id: string): string {
  return `shots/${id.replace(/[^A-Za-z0-9._-]+/g, "_")}.png`;
}
