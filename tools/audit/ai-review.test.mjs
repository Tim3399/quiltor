import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CACHE_DIR, DEFAULT_MODEL, SKIPPED_MESSAGE, reviewManifest } from "./ai-review.mjs";
import { readManifest, writeManifest } from "./manifest.mjs";

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "ai-review.mjs");

/** PNG signature + IHDR for a 200x100 image; `tag` makes the bytes (and hash) unique. */
function fakePng(tag) {
  const header = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(200, 16);
  header.writeUInt32BE(100, 20);
  return Buffer.concat([header, Buffer.from(tag)]);
}

function entry(id, extra = {}) {
  return {
    id,
    state: `workspace.${id}`,
    kind: "view",
    viewport: "mobile",
    theme: "light",
    screenshot: `shots/${id}.png`,
    findings: [],
    ...extra,
  };
}

function makeAuditDir(entries) {
  const dir = mkdtempSync(join(tmpdir(), "ai-review-"));
  mkdirSync(join(dir, "shots"));
  for (const e of entries) writeFileSync(join(dir, e.screenshot), fakePng(e.id));
  writeManifest(dir, {
    generatedAt: "2026-10-23T00:00:00.000Z",
    commit: "abc",
    viewports: {
      mobile: { width: 390, height: 844, touch: true },
      tablet: { width: 820, height: 1180, touch: true },
      desktop: { width: 1440, height: 900, touch: false },
    },
    entries,
    coverage: [],
    findings: [],
    failures: [],
  });
  return dir;
}

function apiReply(findings, init = {}) {
  return new Response(
    JSON.stringify({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ findings }) }],
    }),
    { status: 200, headers: { "content-type": "application/json" }, ...init },
  );
}

const sampleFinding = {
  category: "clipped-content",
  severity: "high",
  message: "The chapter title is cut off at the right edge.",
  rect: { x: 0.5, y: 0.1, width: 0.25, height: 0.2 },
};

function mockFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    return handler(calls.length, body);
  };
  fn.calls = calls;
  return fn;
}

const quiet = () => {};
const baseOptions = { apiKey: "test-key", sleep: async () => {}, log: quiet };

test("writes source ai findings into the manifest and sends a well-formed request", async () => {
  const dir = makeAuditDir([
    entry("a", { viewport: "desktop", theme: "dark", kind: "dialog", state: "dialog.search" }),
  ]);
  try {
    const fetchMock = mockFetch(() => apiReply([sampleFinding]));
    const result = await reviewManifest(dir, { ...baseOptions, fetch: fetchMock });

    assert.equal(result.status, "done");
    const manifest = readManifest(dir);
    assert.deepEqual(manifest.aiReview, { status: "done", model: DEFAULT_MODEL, reviewed: 1 });
    assert.deepEqual(manifest.entries[0].findings, [
      {
        source: "ai",
        rule: "ai:clipped-content",
        severity: "high",
        message: sampleFinding.message,
        rect: { x: 100, y: 10, width: 50, height: 20 },
      },
    ]);

    assert.equal(fetchMock.calls.length, 1);
    const { url, init, body } = fetchMock.calls[0];
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    assert.equal(init.headers["x-api-key"], "test-key");
    assert.equal(body.model, DEFAULT_MODEL);
    assert.equal(body.output_config.format.type, "json_schema");
    assert.equal(body.tool_choice, undefined);
    const [image, text] = body.messages[0].content;
    assert.equal(image.source.media_type, "image/png");
    for (const part of [
      "Viewport: desktop",
      "Theme: dark",
      "State: dialog.search",
      "Kind: dialog",
    ]) {
      assert.match(text.text, new RegExp(part));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a second run is served from the cache and makes no fetches", async () => {
  const dir = makeAuditDir([entry("a"), entry("b")]);
  try {
    const first = mockFetch(() => apiReply([sampleFinding]));
    await reviewManifest(dir, { ...baseOptions, fetch: first });
    assert.equal(first.calls.length, 2);
    assert.equal(readdirSync(join(dir, CACHE_DIR)).length, 2);

    const second = mockFetch(() => assert.fail("cache miss"));
    const result = await reviewManifest(dir, { ...baseOptions, fetch: second });
    assert.equal(second.calls.length, 0);
    assert.equal(result.status, "done");
    assert.equal(readManifest(dir).entries[1].findings.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the cache key includes the model", async () => {
  const dir = makeAuditDir([entry("a")]);
  try {
    await reviewManifest(dir, { ...baseOptions, fetch: mockFetch(() => apiReply([])) });
    const other = mockFetch(() => apiReply([]));
    await reviewManifest(dir, { ...baseOptions, model: "claude-haiku-5-5", fetch: other });
    assert.equal(other.calls.length, 1);
    assert.equal(other.calls[0].body.model, "claude-haiku-5-5");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a rerun replaces old ai findings and keeps rule findings", async () => {
  const ruleFinding = { source: "rules", rule: "overlap", severity: "low", message: "x" };
  const staleAi = { source: "ai", rule: "ai:other", severity: "low", message: "old" };
  const dir = makeAuditDir([entry("a", { findings: [ruleFinding, staleAi] })]);
  try {
    await reviewManifest(dir, {
      ...baseOptions,
      fetch: mockFetch(() => apiReply([sampleFinding])),
    });
    const findings = readManifest(dir).entries[0].findings;
    assert.equal(findings.length, 2);
    assert.deepEqual(findings[0], ruleFinding);
    assert.equal(findings[1].rule, "ai:clipped-content");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("without an API key the review is skipped and the manifest says so", async () => {
  const dir = makeAuditDir([entry("a")]);
  try {
    const lines = [];
    const fetchMock = mockFetch(() => assert.fail("must not call the API"));
    const result = await reviewManifest(dir, {
      fetch: fetchMock,
      log: (line) => lines.push(line),
    });
    assert.equal(result.status, "skipped");
    assert.deepEqual(lines, [SKIPPED_MESSAGE]);
    assert.deepEqual(readManifest(dir).aiReview, { status: "skipped" });
    assert.equal(fetchMock.calls.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the command line exits 0 without a key and prints the skip message", () => {
  const dir = makeAuditDir([entry("a")]);
  try {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    const run = spawnSync(process.execPath, [scriptPath, dir], { env, encoding: "utf8" });
    assert.equal(run.status, 0);
    assert.equal(run.stdout.trim(), "AI review skipped: ANTHROPIC_API_KEY not set");
    assert.deepEqual(readManifest(dir).aiReview, { status: "skipped" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the command line exits non-zero when the manifest is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "ai-review-empty-"));
  try {
    const run = spawnSync(process.execPath, [scriptPath, dir], {
      env: { ...process.env, ANTHROPIC_API_KEY: "k" },
      encoding: "utf8",
    });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /ai-review failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a 429 is retried after the retry-after delay", async () => {
  const dir = makeAuditDir([entry("a")]);
  try {
    const sleeps = [];
    const fetchMock = mockFetch((n) =>
      n === 1
        ? new Response("{}", { status: 429, headers: { "retry-after": "7" } })
        : apiReply([sampleFinding]),
    );
    const result = await reviewManifest(dir, {
      ...baseOptions,
      fetch: fetchMock,
      sleep: async (ms) => sleeps.push(ms),
    });
    assert.equal(result.status, "done");
    assert.equal(fetchMock.calls.length, 2);
    assert.deepEqual(sleeps, [7000]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a 529 is retried with exponential backoff", async () => {
  const dir = makeAuditDir([entry("a")]);
  try {
    const sleeps = [];
    const fetchMock = mockFetch((n) =>
      n <= 2 ? new Response("{}", { status: 529 }) : apiReply([]),
    );
    const result = await reviewManifest(dir, {
      ...baseOptions,
      fetch: fetchMock,
      random: () => 0,
      sleep: async (ms) => sleeps.push(ms),
    });
    assert.equal(result.status, "done");
    assert.deepEqual(sleeps, [1000, 2000]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failing image makes the run partial but not fatal, and is not cached", async () => {
  const dir = makeAuditDir([entry("good"), entry("bad")]);
  try {
    const fetchMock = mockFetch((_n, body) => {
      const png = body.messages[0].content[0].source.data;
      return Buffer.from(png, "base64").toString("latin1").includes("bad")
        ? new Response('{"error":"bad image"}', { status: 400 })
        : apiReply([sampleFinding]);
    });
    const result = await reviewManifest(dir, { ...baseOptions, fetch: fetchMock });
    assert.equal(result.status, "partial");
    const manifest = readManifest(dir);
    assert.deepEqual(manifest.aiReview, { status: "partial", model: DEFAULT_MODEL, reviewed: 1 });
    assert.equal(manifest.entries[0].findings.length, 1);
    assert.equal(manifest.entries[1].findings.length, 0);
    assert.equal(readdirSync(join(dir, CACHE_DIR)).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing screenshot file counts as a failed image", async () => {
  const dir = makeAuditDir([entry("a")]);
  try {
    rmSync(join(dir, "shots/a.png"));
    const result = await reviewManifest(dir, {
      ...baseOptions,
      fetch: mockFetch(() => assert.fail("no screenshot, no request")),
    });
    assert.equal(result.status, "partial");
    assert.equal(existsSync(join(dir, CACHE_DIR)), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("concurrency is limited to the configured number of requests", async () => {
  const dir = makeAuditDir(["a", "b", "c", "d", "e", "f"].map((id) => entry(id)));
  try {
    let active = 0;
    let peak = 0;
    const fetchMock = mockFetch(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return apiReply([]);
    });
    await reviewManifest(dir, { ...baseOptions, fetch: fetchMock, concurrency: 2 });
    assert.equal(fetchMock.calls.length, 6);
    assert.equal(peak, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
