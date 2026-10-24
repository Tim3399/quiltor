// AI visual review for the layout audit. Reads <auditDir>/manifest.json, sends every entry's
// screenshot to the Claude Messages API and writes the resulting `source: "ai"` findings back.
//
//   node tools/audit/ai-review.mjs [auditDir]
//
// Environment: ANTHROPIC_API_KEY (required, otherwise the review is skipped),
// QUILTOR_AUDIT_MODEL, QUILTOR_AUDIT_CONCURRENCY, ANTHROPIC_BASE_URL.
//
// The API is called with plain `fetch`; the audit tools deliberately add no dependency.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_AUDIT_DIR, readManifest, writeManifest } from "./manifest.mjs";

/** Bump when the prompt or the response schema changes; it is part of the cache key. */
export const PROMPT_VERSION = "1";
export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const DEFAULT_CONCURRENCY = 4;
export const DEFAULT_BASE_URL = "https://api.anthropic.com";
export const CACHE_DIR = ".ai-cache";
export const SKIPPED_MESSAGE = "AI review skipped: ANTHROPIC_API_KEY not set";

const API_VERSION = "2023-06-01";
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 60_000;
/** Messages API limit for a single base64 image. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 529]);

export const CATEGORIES = [
  "clipped-content",
  "overlap",
  "alignment",
  "spacing",
  "readability",
  "outside-viewport",
  "touch-target",
  "other",
];

const SYSTEM_PROMPT = `You are a meticulous UI layout reviewer for a writing application used on phones, tablets and desktops.
You receive one screenshot of a single interface state. Report only concrete layout defects that are visible in the image:
- clipped or truncated content (text cut off without an ellipsis, controls cut off by their container)
- overlapping elements
- misalignment and inconsistent spacing
- unreadable text (low contrast, too small, text on a busy background)
- content or controls that extend beyond the edge of the image or are partly off-screen
- on touch viewports: controls that look too small or too close together to tap reliably
Do not comment on content, wording, taste or features. Interface text is German on purpose; do not report it as a defect.
Do not invent problems. If the layout looks sound, return an empty list.
Write each message in English as one short, specific sentence that names the affected element.
For "rect", give the affected region as fractions of the image (0 to 1, origin top-left), or null if no single region applies.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string", enum: CATEGORIES },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          message: { type: "string" },
          rect: {
            anyOf: [
              { type: "null" },
              {
                type: "object",
                properties: {
                  x: { type: "number" },
                  y: { type: "number" },
                  width: { type: "number" },
                  height: { type: "number" },
                },
                required: ["x", "y", "width", "height"],
                additionalProperties: false,
              },
            ],
          },
        },
        required: ["category", "severity", "message", "rect"],
        additionalProperties: false,
      },
    },
  },
  required: ["findings"],
  additionalProperties: false,
};

/** @typedef {import("./manifest.mjs").Finding} Finding */
/** @typedef {import("./manifest.mjs").Entry} Entry */

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Pixel size from a PNG header, or null when the buffer is not a PNG. */
function pngSize(bytes) {
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function buildPrompt(entry, size) {
  const lines = [
    `Viewport: ${entry.viewport}${entry.viewport === "desktop" ? " (mouse input)" : " (touch input)"}`,
    `Theme: ${entry.theme}`,
    `State: ${entry.state}`,
    `Kind: ${entry.kind}`,
  ];
  if (size) lines.push(`Image size: ${size.width}x${size.height} px`);
  lines.push("Review this screenshot for layout defects.");
  return lines.join("\n");
}

function cacheKey(entry, imageHash, model) {
  const context = JSON.stringify([entry.viewport, entry.theme, entry.state, entry.kind]);
  return sha256(`${imageHash}\n${model}\n${PROMPT_VERSION}\n${context}`);
}

function retryDelayMs(response, attempt, random) {
  const header = response?.headers?.get?.("retry-after");
  const seconds = header === null || header === undefined ? Number.NaN : Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_DELAY_MS);
  return Math.min(BASE_DELAY_MS * 2 ** attempt + random() * 250, MAX_DELAY_MS);
}

/** POST one request, retrying 429/529/5xx and network errors with backoff. Returns parsed JSON. */
async function postWithRetry(url, init, { fetch: doFetch, sleep, random, log }) {
  let lastError;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let response;
    try {
      response = await doFetch(url, init);
    } catch (error) {
      lastError = new Error(`network error: ${error.message}`);
      if (attempt < MAX_ATTEMPTS - 1) await sleep(retryDelayMs(null, attempt, random));
      continue;
    }
    if (response.ok) return response.json();
    const body = await response.text().catch(() => "");
    lastError = new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
    if (!RETRYABLE_STATUS.has(response.status)) throw lastError;
    if (attempt < MAX_ATTEMPTS - 1) {
      const delay = retryDelayMs(response, attempt, random);
      log(`HTTP ${response.status}, retrying in ${Math.round(delay)} ms`);
      await sleep(delay);
    }
  }
  throw lastError;
}

function toFindings(parsed, size) {
  const findings = [];
  for (const item of parsed.findings ?? []) {
    /** @type {Finding} */
    const finding = {
      source: "ai",
      rule: `ai:${item.category}`,
      severity: item.severity,
      message: item.message,
    };
    const r = item.rect;
    if (r && size) {
      finding.rect = {
        x: Math.round(r.x * size.width),
        y: Math.round(r.y * size.height),
        width: Math.round(r.width * size.width),
        height: Math.round(r.height * size.height),
      };
    }
    findings.push(finding);
  }
  return findings;
}

/** Review one screenshot. Returns findings; throws when the review itself failed. */
async function reviewEntry(auditDir, entry, ctx) {
  const path = join(auditDir, entry.screenshot);
  if (!existsSync(path)) throw new Error(`screenshot missing: ${entry.screenshot}`);
  const bytes = readFileSync(path);
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`screenshot larger than 5 MB: ${entry.screenshot}`);
  }
  const size = pngSize(bytes);
  const cachePath = join(auditDir, CACHE_DIR, `${cacheKey(entry, sha256(bytes), ctx.model)}.json`);

  if (existsSync(cachePath)) {
    try {
      return { findings: JSON.parse(readFileSync(cachePath, "utf8")), cached: true };
    } catch {
      // A corrupt cache file is treated as a miss and overwritten below.
    }
  }

  const body = {
    model: ctx.model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    output_config: { effort: "medium", format: { type: "json_schema", schema: RESPONSE_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: bytes.toString("base64") },
          },
          { type: "text", text: buildPrompt(entry, size) },
        ],
      },
    ],
  };
  const data = await postWithRetry(
    `${ctx.baseUrl}/v1/messages`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ctx.apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify(body),
    },
    ctx,
  );

  if (data.stop_reason === "refusal") throw new Error("the model refused to review this image");
  if (data.stop_reason === "max_tokens") throw new Error("response truncated (max_tokens)");
  const text = (data.content ?? []).find((block) => block.type === "text")?.text;
  if (typeof text !== "string") throw new Error("response has no text block");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("response is not valid JSON");
  }
  const findings = toFindings(parsed, size);
  mkdirSync(join(auditDir, CACHE_DIR), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(findings));
  return { findings, cached: false };
}

/**
 * Review every manifest entry and write the result back to the manifest.
 *
 * @param {string} auditDir
 * @param {{ fetch?: typeof fetch, apiKey?: string, model?: string, concurrency?: number,
 *   baseUrl?: string, sleep?: (ms: number) => Promise<void>, random?: () => number,
 *   log?: (line: string) => void }} [options]
 */
export async function reviewManifest(auditDir = DEFAULT_AUDIT_DIR, options = {}) {
  const log = options.log ?? ((line) => console.log(line));
  const manifest = readManifest(auditDir); // a missing manifest is a technical failure
  if (!options.apiKey) {
    log(SKIPPED_MESSAGE);
    manifest.aiReview = { status: "skipped" };
    writeManifest(auditDir, manifest);
    return { status: "skipped", reviewed: 0, fetches: 0 };
  }

  const model = options.model || DEFAULT_MODEL;
  const concurrency = Math.max(1, Math.floor(options.concurrency || DEFAULT_CONCURRENCY));
  let fetches = 0;
  const innerFetch = options.fetch ?? globalThis.fetch;
  const ctx = {
    apiKey: options.apiKey,
    model,
    baseUrl: (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    fetch: (...args) => {
      fetches++;
      return innerFetch(...args);
    },
    sleep: options.sleep ?? defaultSleep,
    random: options.random ?? Math.random,
    log,
  };

  const results = new Array(manifest.entries.length);
  let next = 0;
  const worker = async () => {
    while (next < manifest.entries.length) {
      const index = next++;
      const entry = manifest.entries[index];
      try {
        results[index] = { ok: true, ...(await reviewEntry(auditDir, entry, ctx)) };
      } catch (error) {
        results[index] = { ok: false, error: error.message };
        log(`AI review failed for ${entry.id}: ${error.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, manifest.entries.length) }, worker));

  let reviewed = 0;
  let failed = 0;
  manifest.entries.forEach((entry, index) => {
    const result = results[index];
    if (!result.ok) {
      failed++;
      return; // keep the previous AI findings of an entry whose review failed
    }
    reviewed++;
    // A new run replaces the old AI findings instead of doubling them.
    entry.findings = [...entry.findings.filter((f) => f.source !== "ai"), ...result.findings];
  });

  const status = failed > 0 ? "partial" : "done";
  manifest.aiReview = { status, model, reviewed };
  writeManifest(auditDir, manifest);
  log(
    `AI review ${status}: ${reviewed}/${manifest.entries.length} screenshots reviewed (${model})`,
  );
  return { status, reviewed, fetches };
}

async function main() {
  const auditDir = process.argv[2] || DEFAULT_AUDIT_DIR;
  const concurrency = Number(process.env.QUILTOR_AUDIT_CONCURRENCY) || DEFAULT_CONCURRENCY;
  await reviewManifest(auditDir, {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.QUILTOR_AUDIT_MODEL,
    baseUrl: process.env.ANTHROPIC_BASE_URL,
    concurrency,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`ai-review failed: ${error.message}`);
    process.exit(1);
  });
}
