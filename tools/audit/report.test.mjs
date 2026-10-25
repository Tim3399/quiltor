import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { writeManifest } from "./manifest.mjs";
import { buildReport, buildSummary, countFindings, escapeHtml, writeReport } from "./report.mjs";

const viewports = {
  mobile: { width: 390, height: 844, touch: true },
  tablet: { width: 820, height: 1180, touch: true },
  desktop: { width: 1440, height: 900, touch: false },
};

function finding(source, rule, severity, extra = {}) {
  return { source, rule, severity, message: `${rule} message`, ...extra };
}

function entry(state, viewport, theme, findings = []) {
  const id = `${state.replace(/[^a-z]/g, "-")}--${viewport}--${theme}`;
  return {
    id,
    state,
    kind: "view",
    viewport,
    theme,
    screenshot: `shots/${id}.png`,
    findings,
  };
}

function manifest(overrides = {}) {
  return {
    generatedAt: "2026-10-23T12:00:00.000Z",
    commit: "abc1234",
    viewports,
    entries: [
      entry("workspace.text", "mobile", "light", [
        finding("rules", "clipped-text", "low", { rect: { x: 1, y: 2, width: 30, height: 10 } }),
        finding("ai", "ai:alignment", "medium"),
      ]),
      entry("workspace.text", "tablet", "light"),
      entry("workspace.text", "desktop", "dark", [finding("rules", "contrast", "high")]),
    ],
    coverage: [
      { component: "A", file: "a.tsx", reached: true, evidence: "menu Aktionen" },
      { component: "B", file: "b.tsx", reached: false, exception: "needs a cloud account" },
      { component: "C", file: "c.tsx", reached: false },
    ],
    findings: [finding("rules", "coverage-unreached", "high")],
    failures: [{ state: "dialog.cloud", viewport: "mobile", theme: "light", error: "timeout" }],
    ...overrides,
  };
}

test("counts findings by severity, source and viewport", () => {
  const counts = countFindings(manifest());
  assert.equal(counts.total, 4);
  assert.deepEqual(counts.bySeverity, { high: 2, medium: 1, low: 1 });
  assert.deepEqual(counts.bySource, { rules: 3, ai: 1 });
  assert.deepEqual(counts.byViewport, { mobile: 2, tablet: 0, desktop: 1, none: 1 });
  assert.equal(counts.entries, 3);
  assert.equal(counts.states, 1);
  assert.equal(counts.coverageReached, 1);
  assert.equal(counts.coverageExcepted, 1);
  assert.equal(counts.coverageUnreached, 1);
  assert.equal(counts.failures, 1);
});

test("renders coverage, failures, filters and the counters", () => {
  const html = buildReport(manifest());
  assert.match(html, /<h2>Coverage<\/h2>/);
  assert.match(html, /<h2>Failures<\/h2>/);
  for (const name of ["viewport", "theme", "severity", "source"]) {
    assert.match(html, new RegExp(`data-filter="${name}"`));
  }
  assert.match(html, /data-severity="high"><span class="num">2<\/span>/);
  assert.match(html, /data-rect="\{&quot;x&quot;:1/);
  assert.doesNotMatch(html, /https?:\/\//, "the report must not reference any network resource");
});

test("escapes every manifest string", () => {
  const evil = '<script>alert("x")</script>';
  const html = buildReport(
    manifest({
      commit: evil,
      entries: [
        {
          ...entry(evil, "mobile", "light", [
            finding("rules", evil, "high", { selector: evil, message: evil }),
          ]),
          screenshot: `shots/"><img src=x onerror=alert(1)>.png`,
          trigger: evil,
        },
      ],
      coverage: [{ component: evil, file: evil, reached: true, evidence: evil }],
      failures: [{ state: evil, viewport: "mobile", theme: "light", error: evil }],
      findings: [finding("rules", "loose", "low", { message: evil })],
    }),
  );
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.equal(escapeHtml(`<&>"'`), "&lt;&amp;&gt;&quot;&#39;");
});

test("shows the skip notice when the AI review was skipped or is missing", () => {
  const missing = buildReport(manifest());
  assert.match(missing, /AI review skipped/);
  const skipped = buildReport(manifest({ aiReview: { status: "skipped" } }));
  assert.match(skipped, /AI review skipped/);
  const done = buildReport(
    manifest({ aiReview: { status: "done", model: "claude-sonnet-5-5", reviewed: 3 } }),
  );
  assert.doesNotMatch(done, /AI review skipped/);
  assert.match(done, /AI review done, model claude-sonnet-5-5, 3 screenshots reviewed/);
});

test("summary.md carries the counters", () => {
  const summary = buildSummary(manifest());
  assert.match(summary, /4 findings in 3 screenshots \(1 states\)/);
  assert.match(summary, /\| severity \| high \| medium \| low \|/);
  assert.match(summary, /\| findings \| 2 \| 1 \| 1 \|/);
  assert.match(summary, /Coverage: 1 of 3 components reached, 1 excepted, 1 unreached\./);
  assert.match(summary, /Failures: 1\./);
  assert.match(summary, /AI review skipped/);
});

test("writes index.html and summary.md next to the manifest", () => {
  const dir = mkdtempSync(join(tmpdir(), "audit-report-"));
  try {
    mkdirSync(join(dir, "shots"));
    writeFileSync(join(dir, "shots", "x.png"), "");
    writeManifest(dir, manifest());
    writeReport(dir);
    assert.match(
      readFileSync(join(dir, "index.html"), "utf8"),
      /<title>Quiltor layout audit<\/title>/,
    );
    assert.match(readFileSync(join(dir, "summary.md"), "utf8"), /## Layout audit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
