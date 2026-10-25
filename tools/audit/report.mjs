// Layout audit report: turns <auditDir>/manifest.json into a static index.html (no CDN, no
// network) and a summary.md with the counters (for $GITHUB_STEP_SUMMARY).
//
//   node tools/audit/report.mjs [auditDir]
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_AUDIT_DIR, readManifest } from "./manifest.mjs";

/** @typedef {import("./manifest.mjs").Manifest} Manifest */
/** @typedef {import("./manifest.mjs").Entry} Entry */
/** @typedef {import("./manifest.mjs").Finding} Finding */

const VIEWPORT_ORDER = ["mobile", "tablet", "desktop"];
const THEME_ORDER = ["light", "dark"];
const SEVERITY_ORDER = ["high", "medium", "low"];
const SOURCE_ORDER = ["rules", "ai"];

/** @param {unknown} value */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Every finding of the run, with the entry it belongs to (if any).
 * @param {Manifest} manifest
 * @returns {{ finding: Finding, entry?: Entry }[]}
 */
function allFindings(manifest) {
  const withEntry = (manifest.entries ?? []).flatMap((entry) =>
    (entry.findings ?? []).map((finding) => ({ finding, entry })),
  );
  const loose = (manifest.findings ?? []).map((finding) => ({ finding }));
  return [...withEntry, ...loose];
}

/** @param {string[]} keys @param {string[]} order */
function zeroed(keys, order) {
  const counts = {};
  for (const key of [...order, ...keys.filter((key) => !order.includes(key))]) counts[key] = 0;
  return counts;
}

/**
 * Counters by severity, source and viewport. Findings without a screenshot have no viewport
 * and are counted under "none".
 * @param {Manifest} manifest
 */
export function countFindings(manifest) {
  const found = allFindings(manifest);
  const bySeverity = zeroed([], SEVERITY_ORDER);
  const bySource = zeroed([], SOURCE_ORDER);
  const byViewport = zeroed([], VIEWPORT_ORDER);
  byViewport.none = 0;
  for (const { finding, entry } of found) {
    bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
    bySource[finding.source] = (bySource[finding.source] ?? 0) + 1;
    const viewport = entry ? entry.viewport : "none";
    byViewport[viewport] = (byViewport[viewport] ?? 0) + 1;
  }
  const coverage = manifest.coverage ?? [];
  return {
    total: found.length,
    bySeverity,
    bySource,
    byViewport,
    entries: (manifest.entries ?? []).length,
    states: new Set((manifest.entries ?? []).map((entry) => entry.state)).size,
    coverageTotal: coverage.length,
    coverageReached: coverage.filter((item) => item.reached).length,
    coverageExcepted: coverage.filter((item) => !item.reached && item.exception).length,
    coverageUnreached: coverage.filter((item) => !item.reached && !item.exception).length,
    failures: (manifest.failures ?? []).length,
  };
}

/** @param {Manifest} manifest */
function aiSkipped(manifest) {
  return !manifest.aiReview || manifest.aiReview.status === "skipped";
}

/** @param {Manifest} manifest */
function aiLine(manifest) {
  if (aiSkipped(manifest)) return "AI review skipped";
  const { status, model, reviewed } = manifest.aiReview;
  const parts = [`AI review ${status}`];
  if (model) parts.push(`model ${model}`);
  if (reviewed !== undefined) parts.push(`${reviewed} screenshots reviewed`);
  return parts.join(", ");
}

/** @param {Record<string, number>} counts */
function mdTable(heading, counts) {
  const keys = Object.keys(counts);
  return [
    `| ${heading} | ${keys.join(" | ")} |`,
    `| --- | ${keys.map(() => "---:").join(" | ")} |`,
    `| findings | ${keys.map((key) => counts[key]).join(" | ")} |`,
  ].join("\n");
}

/**
 * Markdown counters, written to summary.md.
 * @param {Manifest} manifest
 */
export function buildSummary(manifest) {
  const c = countFindings(manifest);
  const lines = [
    "## Layout audit",
    "",
    `${c.total} findings in ${c.entries} screenshots (${c.states} states), commit \`${manifest.commit}\`, generated ${manifest.generatedAt}.`,
    "",
    mdTable("severity", c.bySeverity),
    "",
    mdTable("source", c.bySource),
    "",
    mdTable("viewport", c.byViewport),
    "",
    `Coverage: ${c.coverageReached} of ${c.coverageTotal} components reached, ${c.coverageExcepted} excepted, ${c.coverageUnreached} unreached.`,
    "",
    `Failures: ${c.failures}.`,
    "",
    `${aiLine(manifest)}${aiSkipped(manifest) ? ": ANTHROPIC_API_KEY not set or AI review not requested." : "."}`,
    "",
  ];
  return lines.join("\n");
}

/** @param {Record<string, number>} counts */
function counterTiles(counts, attribute) {
  return Object.entries(counts)
    .map(
      ([key, value]) =>
        `<div class="tile" data-${attribute}="${escapeHtml(key)}"><span class="num">${value}</span><span class="lbl">${escapeHtml(key)}</span></div>`,
    )
    .join("");
}

/** @param {string} label @param {string} name @param {string[]} options */
function select(label, name, options) {
  const items = options
    .map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`)
    .join("");
  return `<label>${escapeHtml(label)} <select data-filter="${name}"><option value="">all</option>${items}</select></label>`;
}

/** @param {Finding} finding */
function findingItem(finding) {
  const rect = finding.rect ? ` data-rect="${escapeHtml(JSON.stringify(finding.rect))}"` : "";
  const selector = finding.selector ? ` <code>${escapeHtml(finding.selector)}</code>` : "";
  return `<li class="finding sev-${escapeHtml(finding.severity)}" data-severity="${escapeHtml(finding.severity)}" data-source="${escapeHtml(finding.source)}"${rect}><b>${escapeHtml(finding.severity)}</b> <span class="rule">${escapeHtml(finding.rule)}</span> ${escapeHtml(finding.message)}${selector}</li>`;
}

/**
 * @param {Manifest} manifest
 * @param {Entry | undefined} entry
 * @param {string} viewport
 */
function cell(manifest, entry, viewport) {
  if (!entry) {
    return `<div class="cell empty" data-viewport="${escapeHtml(viewport)}"><p class="muted">${escapeHtml(viewport)}: no screenshot</p></div>`;
  }
  const size = manifest.viewports?.[entry.viewport];
  const sizeAttrs = size ? ` data-vw="${size.width}" data-vh="${size.height}"` : "";
  const flags = [
    entry.trigger ? `trigger ${escapeHtml(entry.trigger)}` : "",
    entry.viewportSpecific ? "viewport specific" : "",
  ]
    .filter(Boolean)
    .join(", ");
  const findings = (entry.findings ?? []).map(findingItem).join("");
  return `<div class="cell" data-viewport="${escapeHtml(entry.viewport)}" data-theme="${escapeHtml(entry.theme)}">
<h4>${escapeHtml(entry.viewport)} / ${escapeHtml(entry.theme)} <span class="muted">${escapeHtml(entry.kind)}${flags ? `, ${flags}` : ""}</span></h4>
<div class="shot"${sizeAttrs}><img loading="lazy" src="${escapeHtml(entry.screenshot)}" alt="${escapeHtml(entry.state)} (${escapeHtml(entry.viewport)}, ${escapeHtml(entry.theme)})"></div>
<ul class="findings">${findings || '<li class="muted none">no findings</li>'}</ul>
</div>`;
}

/** @param {Manifest} manifest */
function stateGroups(manifest) {
  const byState = new Map();
  for (const entry of manifest.entries ?? []) {
    if (!byState.has(entry.state)) byState.set(entry.state, []);
    byState.get(entry.state).push(entry);
  }
  const groups = [];
  for (const [state, entries] of byState) {
    const rows = THEME_ORDER.filter((theme) => entries.some((entry) => entry.theme === theme));
    const extraThemes = [...new Set(entries.map((entry) => entry.theme))].filter(
      (theme) => !THEME_ORDER.includes(theme),
    );
    const grid = [...rows, ...extraThemes]
      .map((theme) =>
        VIEWPORT_ORDER.map((viewport) =>
          cell(
            manifest,
            entries.find((entry) => entry.viewport === viewport && entry.theme === theme),
            viewport,
          ),
        ).join(""),
      )
      .join("");
    groups.push(
      `<section class="state" data-state="${escapeHtml(state)}"><h3>${escapeHtml(state)}</h3><div class="grid">${grid}</div></section>`,
    );
  }
  return groups.join("\n");
}

/** @param {Manifest} manifest */
function coverageSection(manifest) {
  const c = countFindings(manifest);
  const rows = (manifest.coverage ?? [])
    .map((item) => {
      const status = item.reached ? "reached" : item.exception ? "exception" : "unreached";
      const note = item.reached ? item.evidence : item.exception;
      return `<tr class="cov-${status}"><td>${escapeHtml(item.component)}</td><td><code>${escapeHtml(item.file)}</code></td><td>${status}</td><td>${escapeHtml(note ?? "")}</td></tr>`;
    })
    .join("");
  return `<section id="coverage"><h2>Coverage</h2>
<p>${c.coverageReached} of ${c.coverageTotal} components reached, ${c.coverageExcepted} excepted, ${c.coverageUnreached} unreached.</p>
<table><thead><tr><th>Component</th><th>File</th><th>Status</th><th>Evidence or exception</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="muted">no coverage records</td></tr>'}</tbody></table></section>`;
}

/** @param {Manifest} manifest */
function failuresSection(manifest) {
  const failures = manifest.failures ?? [];
  const rows = failures
    .map(
      (failure) =>
        `<tr><td>${escapeHtml(failure.state)}</td><td>${escapeHtml(failure.viewport)}</td><td>${escapeHtml(failure.theme)}</td><td><pre>${escapeHtml(failure.error)}</pre></td></tr>`,
    )
    .join("");
  return `<section id="failures"><h2>Failures</h2>
<p>${failures.length} states could not be captured.</p>
${failures.length ? `<table><thead><tr><th>State</th><th>Viewport</th><th>Theme</th><th>Error</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">none</p>'}</section>`;
}

/** @param {Manifest} manifest */
function looseFindingsSection(manifest) {
  const findings = manifest.findings ?? [];
  if (!findings.length) return "";
  return `<section id="loose"><h2>Findings without a screenshot</h2><ul class="findings">${findings.map(findingItem).join("")}</ul></section>`;
}

const STYLE = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#d0d0d0;--high:#c0261b;--medium:#b86e00;--low:#2764c0;--panel:#f5f5f5}
@media (prefers-color-scheme:dark){:root{--bg:#161616;--fg:#e8e8e8;--muted:#9a9a9a;--line:#3a3a3a;--panel:#222}}
body{margin:0;padding:1rem 1.5rem;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,sans-serif}
h1,h2,h3,h4{margin:.6em 0 .3em}
.tiles{display:flex;flex-wrap:wrap;gap:.5rem;margin:.3rem 0 .8rem}
.tile{border:1px solid var(--line);background:var(--panel);padding:.3rem .7rem;border-radius:6px;min-width:4.5rem;text-align:center}
.tile .num{display:block;font-size:1.4rem;font-weight:600}.tile .lbl{color:var(--muted)}
.filters{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:1rem;padding:.5rem 0;background:var(--bg);border-bottom:1px solid var(--line)}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.6rem;align-items:start}
.cell{border:1px solid var(--line);padding:.4rem;border-radius:6px;min-width:0}
.cell h4{font-size:.85rem;margin:0 0 .3rem}.cell.empty{opacity:.6}
.shot{position:relative;line-height:0}.shot img{width:100%;height:auto;border:1px solid var(--line)}
.box{position:absolute;border:2px solid var(--high);background:rgba(192,38,27,.15);pointer-events:none;box-sizing:border-box}
.box.sev-medium{border-color:var(--medium);background:rgba(184,110,0,.15)}.box.sev-low{border-color:var(--low);background:rgba(39,100,192,.15)}
.findings{list-style:none;margin:.4rem 0 0;padding:0;font-size:.8rem}
.finding{padding:.15rem .3rem;margin:.15rem 0;border-left:3px solid var(--line);cursor:default}
.finding.sev-high{border-color:var(--high)}.finding.sev-medium{border-color:var(--medium)}.finding.sev-low{border-color:var(--low)}
.finding.active{background:var(--panel)}
.muted{color:var(--muted)}.rule{font-family:ui-monospace,monospace}
table{border-collapse:collapse;width:100%;font-size:.85rem}th,td{border:1px solid var(--line);padding:.25rem .5rem;text-align:left;vertical-align:top}
.cov-unreached td{background:rgba(192,38,27,.12)}pre{margin:0;white-space:pre-wrap}
.notice{border:1px solid var(--line);background:var(--panel);padding:.4rem .7rem;border-radius:6px;margin:.5rem 0}
.hidden{display:none!important}
@media (max-width:900px){.grid{grid-template-columns:1fr}}
`;

// Filtering and the rect overlay need a little script. It is inline and touches no network.
const SCRIPT = `
(function () {
  var filters = {};
  var selects = document.querySelectorAll("select[data-filter]");
  function apply() {
    var sev = filters.severity, src = filters.source;
    document.querySelectorAll(".cell[data-theme]").forEach(function (cell) {
      var show = (!filters.viewport || cell.dataset.viewport === filters.viewport) &&
        (!filters.theme || cell.dataset.theme === filters.theme);
      var anyMatch = false;
      cell.querySelectorAll(".finding").forEach(function (f) {
        var ok = (!sev || f.dataset.severity === sev) && (!src || f.dataset.source === src);
        f.classList.toggle("hidden", !ok);
        if (ok) anyMatch = true;
      });
      if ((sev || src) && !anyMatch) show = false;
      cell.classList.toggle("hidden", !show);
    });
    document.querySelectorAll(".cell.empty").forEach(function (cell) {
      cell.classList.toggle("hidden", !!(filters.viewport && cell.dataset.viewport !== filters.viewport) || !!(sev || src));
    });
    document.querySelectorAll(".state").forEach(function (state) {
      var visible = state.querySelector(".cell:not(.hidden):not(.empty)");
      state.classList.toggle("hidden", !visible);
    });
    drawBoxes();
  }
  function drawBoxes() {
    document.querySelectorAll(".shot").forEach(function (shot) {
      shot.querySelectorAll(".box").forEach(function (box) { box.remove(); });
      var img = shot.querySelector("img");
      var vw = Number(shot.dataset.vw);
      if (!img || !vw || !img.clientWidth) return;
      var scale = img.clientWidth / vw;
      shot.parentNode.querySelectorAll(".finding[data-rect]:not(.hidden)").forEach(function (f) {
        var r = JSON.parse(f.dataset.rect);
        var box = document.createElement("div");
        box.className = "box sev-" + f.dataset.severity;
        box.style.left = r.x * scale + "px";
        box.style.top = r.y * scale + "px";
        box.style.width = Math.max(r.width * scale, 2) + "px";
        box.style.height = Math.max(r.height * scale, 2) + "px";
        box.title = f.textContent;
        shot.appendChild(box);
      });
    });
  }
  selects.forEach(function (el) {
    el.addEventListener("change", function () { filters[el.dataset.filter] = el.value; apply(); });
  });
  window.addEventListener("resize", drawBoxes);
  document.querySelectorAll(".shot img").forEach(function (img) {
    img.addEventListener("load", drawBoxes);
  });
  apply();
})();
`;

/**
 * Complete static HTML document. Every manifest string is escaped.
 * @param {Manifest} manifest
 */
export function buildReport(manifest) {
  const c = countFindings(manifest);
  const skipped = aiSkipped(manifest);
  const notice = skipped
    ? '<p class="notice" id="ai-status">AI review skipped: no AI findings are included in this report.</p>'
    : `<p class="notice" id="ai-status">${escapeHtml(aiLine(manifest))}.</p>`;
  const viewports = Object.entries(manifest.viewports ?? {})
    .map(([name, size]) => `${name} ${size.width}x${size.height}${size.touch ? " touch" : ""}`)
    .join(", ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quiltor layout audit</title>
<style>${STYLE}</style>
</head>
<body>
<h1>Quiltor layout audit</h1>
<p class="muted">Commit ${escapeHtml(manifest.commit)}, generated ${escapeHtml(manifest.generatedAt)}. ${escapeHtml(viewports)}.</p>
${notice}
<section id="summary">
<h2>Summary</h2>
<p>${c.total} findings in ${c.entries} screenshots across ${c.states} states. <a href="#coverage">Coverage</a>, <a href="#failures">Failures</a>.</p>
<h3>By severity</h3><div class="tiles">${counterTiles(c.bySeverity, "severity")}</div>
<h3>By source</h3><div class="tiles">${counterTiles(c.bySource, "source")}</div>
<h3>By viewport</h3><div class="tiles">${counterTiles(c.byViewport, "viewport")}</div>
</section>
<div class="filters">
${select("Viewport", "viewport", VIEWPORT_ORDER)}
${select("Theme", "theme", THEME_ORDER)}
${select("Severity", "severity", SEVERITY_ORDER)}
${select("Source", "source", SOURCE_ORDER)}
</div>
<section id="states"><h2>States</h2>
${stateGroups(manifest) || '<p class="muted">no screenshots</p>'}
</section>
${looseFindingsSection(manifest)}
${coverageSection(manifest)}
${failuresSection(manifest)}
<script>${SCRIPT}</script>
</body>
</html>
`;
}

/**
 * Write index.html and summary.md into the audit directory.
 * @param {string} auditDir
 */
export function writeReport(auditDir) {
  const manifest = readManifest(auditDir);
  writeFileSync(join(auditDir, "index.html"), buildReport(manifest));
  writeFileSync(join(auditDir, "summary.md"), buildSummary(manifest));
  return countFindings(manifest);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const auditDir = process.argv[2] ?? DEFAULT_AUDIT_DIR;
  try {
    const c = writeReport(auditDir);
    console.log(
      `Layout audit report: ${join(auditDir, "index.html")} (${c.total} findings, ${c.entries} screenshots, ${c.failures} failures)`,
    );
  } catch (error) {
    console.error(`Layout audit report failed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
