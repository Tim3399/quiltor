// Collects the entries of one capture test and writes them as a partial manifest. Every test
// writes its own part, so workers never share a file; the global teardown merges them.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { COVERAGE_MAP } from "./coverage-map.ts";
import { analyzeLayout } from "./layout-rules";
import {
  type AriaNode,
  coverageKey,
  evidenceMatches,
  type ManifestPart,
  PARTS_DIR,
  parseAriaSnapshot,
} from "./parts.ts";
import {
  AUDIT_DIR,
  AUDIT_VIEWPORTS,
  type Entry,
  type EntryKind,
  entryId,
  type Finding,
  screenshotPath,
  type ThemeName,
  type ViewportName,
} from "./types.ts";

export type CaptureOptions = {
  kind: EntryKind;
  trigger?: string;
  viewportSpecific?: boolean;
  /** CSS selector of the open popup; switches the screenshot to the viewport. */
  popupSelector?: string;
};

export class AuditRecorder {
  readonly part: ManifestPart;
  readonly viewport: ViewportName;
  readonly theme: ThemeName;
  private readonly page: Page;
  private readonly seenIds = new Set<string>();

  constructor(page: Page, project: string, scenario: string, viewport: ViewportName, theme: ThemeName) {
    this.page = page;
    this.viewport = viewport;
    this.theme = theme;
    this.part = {
      run: process.env.QUILTOR_AUDIT_RUN ?? "manual",
      project,
      scenario,
      viewport,
      theme,
      entries: [],
      findings: [],
      failures: [],
      observed: {},
    };
  }

  get touch(): boolean {
    return AUDIT_VIEWPORTS[this.viewport].touch;
  }

  has(state: string): boolean {
    return this.seenIds.has(entryId(state, this.viewport, this.theme));
  }

  /** Visible role/name pairs right now; hidden elements are not part of the snapshot. */
  async visibleNodes(): Promise<AriaNode[]> {
    try {
      return parseAriaSnapshot(await this.page.locator("body").ariaSnapshot({ timeout: 10_000 }));
    } catch {
      return [];
    }
  }

  /** Records which coverage-map evidence is visible now and returns the matching components. */
  async observe(state: string): Promise<string[]> {
    if (process.env.QUILTOR_AUDIT_DEBUG) {
      // Debug aid: the snapshot the evidence is matched against, next to the screenshot.
      const snapshot = await this.page.locator("body").ariaSnapshot().catch(String);
      mkdirSync(join(AUDIT_DIR, "aria"), { recursive: true });
      writeFileSync(
        join(AUDIT_DIR, "aria", `${screenshotPath(entryId(state, this.viewport, this.theme)).slice(6)}.txt`),
        snapshot,
      );
    }
    const nodes = await this.visibleNodes();
    const components = new Set<string>();
    for (const entry of COVERAGE_MAP) {
      if (!evidenceMatches(entry, nodes)) continue;
      components.add(entry.component);
      this.part.observed[coverageKey(entry)] ??= state;
    }
    return [...components].sort();
  }

  async capture(state: string, options: CaptureOptions): Promise<Entry | undefined> {
    const id = entryId(state, this.viewport, this.theme);
    if (this.seenIds.has(id)) return undefined;
    this.seenIds.add(id);
    const screenshot = screenshotPath(id);
    await this.page.screenshot({
      path: join(AUDIT_DIR, screenshot),
      fullPage: !options.popupSelector,
      animations: "disabled",
      caret: "hide",
      timeout: 20_000,
    });
    const components = await this.observe(state);
    let findings: Finding[] = [];
    try {
      findings = await analyzeLayout(this.page, {
        viewport: this.viewport,
        touch: this.touch,
        popupSelector: options.popupSelector,
      });
    } catch (error) {
      this.fail(`${state}/analyze`, error);
    }
    const entry: Entry = {
      id,
      state,
      kind: options.kind,
      viewport: this.viewport,
      theme: this.theme,
      screenshot,
      ...(options.trigger ? { trigger: options.trigger } : {}),
      ...(options.viewportSpecific ? { viewportSpecific: true } : {}),
      ...(components.length > 0 ? { components } : {}),
      findings,
    };
    this.part.entries.push(entry);
    return entry;
  }

  fail(state: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.part.failures.push({
      state,
      viewport: this.viewport,
      theme: this.theme,
      // Playwright messages carry ANSI colour codes and long call logs.
      error: message
        .replace(/\u001b\[[0-9;]*m/g, "")
        .split("\n")
        .slice(0, 6)
        .join("\n"),
    });
  }

  finding(finding: Finding): void {
    this.part.findings.push(finding);
  }

  write(): void {
    mkdirSync(PARTS_DIR, { recursive: true });
    const name = `${this.part.project}--${this.part.scenario}`.replace(/[^A-Za-z0-9._-]+/g, "_");
    writeFileSync(join(PARTS_DIR, `${name}.json`), `${JSON.stringify(this.part, null, 2)}\n`);
  }
}
