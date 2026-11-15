import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type APIRequestContext, type BrowserContext, chromium, type Page } from "@playwright/test";
import { seedExampleWorld } from "./support/example-world";
import { ROOT } from "./support/python-process";
import {
  presentAsHosted,
  startTestHooksServer,
  type TestHooksServer,
} from "./support/test-hooks-server";
import { test as base, createTestWorld, expect } from "./support/world-fixture";

// The in-browser engine with the real model, end to end (D-T-61-7-E2E, T-61 part 7).
//
// Runs only with QUILTOR_WEBLLM_E2E=1: it downloads Qwen3-4B (about 2.5 GB) from Hugging Face
// and needs a hardware WebGPU adapter, neither of which CI has. Its server is a Quiltor of its
// own with QUILTOR_CSP=enforce and without test hooks, so connect-src is the policy that ships;
// the cspGuard of the base fixture fails the test on any violation.
//
// The context presents the server as a hosted one (presentAsHosted): since D-205 only a hosted
// server offers "Im Browser", a local installable one offers the server engine alone.
//
// QUILTOR_WEBLLM_PROFILE=<dir> keeps the browser profile, and with it WebLLM's model cache, in
// that directory instead of a temporary one: the 2.5 GB land on a disk of one's choosing.
// The profile is shared by the tests of the file (worker-scoped), so the model is downloaded
// once: the first test fetches it, the later ones find it cached, the last one removes it.
// QUILTOR_WEBLLM_HEADED=1 runs Chromium headed, for a machine where headless gets no adapter.

const ENABLED = process.env.QUILTOR_WEBLLM_E2E === "1";
const MODEL_ID = "Qwen3-4B-q4f16_1-MLC";
const PROFILE = process.env.QUILTOR_WEBLLM_PROFILE;
const HEADLESS = process.env.QUILTOR_WEBLLM_HEADED !== "1";
const ARGS = ["--enable-unsafe-webgpu", "--enable-features=Vulkan"];

const POLICY = JSON.parse(
  readFileSync(join(ROOT, "src/quiltor/bootstrap/csp-policy.json"), "utf8"),
) as { webllmHosts: string[] };

/** True when `origin` is one of webllmHosts, the single `*.` entry matching any subdomain. */
function allowedHost(origin: string): boolean {
  return POLICY.webllmHosts.some((host) => {
    if (!host.includes("*.")) return host === origin;
    const [scheme, rest] = host.split("://*.");
    const url = new URL(origin);
    return url.protocol === `${scheme}:` && url.hostname.endsWith(`.${rest}`);
  });
}

const test = base.extend<object, { webllmServer: TestHooksServer; profileContext: BrowserContext }>(
  {
    webllmServer: [
      // biome-ignore lint/correctness/noEmptyPattern: Playwright reads the dependencies from the pattern.
      async ({}, use) => {
        const server = await startTestHooksServer({ testHooks: false });
        try {
          await use(server);
        } finally {
          await server.stop();
        }
      },
      { scope: "worker", timeout: 120_000 },
    ],
    baseURL: async ({ webllmServer }, use) => use(webllmServer.url),
    // Worker-scoped, so the world cleanup that runs on page.request after page.close() still
    // finds the context open; a test-scoped persistent context is gone by then.
    profileContext: [
      async ({ webllmServer }, use) => {
        const dir = PROFILE ?? mkdtempSync(join(tmpdir(), "quiltor-webllm-"));
        mkdirSync(dir, { recursive: true });
        const persistent = await chromium.launchPersistentContext(dir, {
          headless: HEADLESS,
          args: ARGS,
          baseURL: webllmServer.url,
          viewport: { width: 1440, height: 900 },
        });
        try {
          await use(persistent);
        } finally {
          await persistent.close();
          if (!PROFILE) rmSync(dir, { recursive: true, force: true });
        }
      },
      { scope: "worker", timeout: 120_000 },
    ],
    context: async ({ profileContext }, use) => {
      await presentAsHosted(profileContext);
      await use(profileContext);
    },
  },
);

// At file level, so a skipped run starts no server either.
test.skip(
  !ENABLED,
  "Needs QUILTOR_WEBLLM_E2E=1: downloads Qwen3-4B (2.5 GB) and needs a hardware WebGPU adapter.",
);

test.use({
  headless: HEADLESS,
  launchOptions: { args: ARGS },
});

/** The text the server sends when the read step could not finish (completion.py). */
const READ_STEP_FALLBACK = "Der sichere Leseschritt konnte nicht abgeschlossen werden.";
/** Figures of the example world an answer may name. */
const EXAMPLE_FIGURES = ["Mara", "Iven", "Oda", "Tilo", "Ada", "Bela", "Lumen"];

/** Asks the open drawer who is in the world, waits for the job and checks the drawer shows it. */
async function askAndRead(page: Page, request: APIRequestContext, worldId: string) {
  const drawer = page.getByRole("complementary", { name: "Lokaler Assistent" });
  const created = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/assistant/jobs" &&
      response.request().method() === "POST",
  );
  await drawer
    .getByRole("textbox", { name: "Nachricht an den lokalen Assistenten" })
    .fill("Wer kommt in dieser Welt vor?");
  await drawer.getByRole("button", { name: "Nachricht senden" }).click();
  const response = await created;
  expect(response.status(), await response.text()).toBe(202);
  expect(response.request().postDataJSON().engine?.kind).not.toBe("server");
  const jobId = ((await response.json()) as { job: { id: string } }).job.id;

  const asked = Date.now();
  let job: { status: string; result?: { message?: string } | null; error?: string } = {
    status: "",
  };
  await expect
    .poll(
      async () => {
        const read = await request.get(`/api/assistant/job?id=${jobId}&world=${worldId}`);
        job = ((await read.json()) as { job: typeof job }).job;
        return job.status;
      },
      { timeout: 15 * 60_000, intervals: [2_000] },
    )
    .toMatch(/^(completed|failed|cancelled)$/);
  const answerSeconds = Math.round((Date.now() - asked) / 1000);
  expect(job.status, job.error).toBe("completed");
  const answer = (job.result?.message ?? "").trim();
  expect(answer.length).toBeGreaterThan(0);
  expect(answer, "the read step ended in the fallback text").not.toContain(READ_STEP_FALLBACK);
  // The drawer polls the job ever less often (up to ~7 s apart near the end, T-61 diagnosis).
  await expect(drawer.getByText(answer.slice(0, 40), { exact: false }).first()).toBeVisible({
    timeout: 30_000,
  });
  return {
    answerSeconds,
    answerLength: answer.length,
    names: EXAMPLE_FIGURES.filter((name) => answer.includes(name)),
  };
}

/** What the run measured, reported even when an assertion fails half-way. */
let lastLog: Record<string, unknown> | null = null;

// biome-ignore lint/correctness/noEmptyPattern: Playwright reads the dependencies from the pattern.
test.afterEach(async ({}, testInfo) => {
  if (!lastLog) return;
  const report = JSON.stringify(lastLog, null, 2);
  console.log(`[webllm-real-model]\n${report}`);
  await testInfo.attach("webllm-real-model", { body: report, contentType: "application/json" });
  lastLog = null;
});

/** Records the hosts the page talks to and the CSP messages of its console. */
function watchNetwork(page: Page, context: BrowserContext) {
  const consoleCsp: string[] = [];
  const origins = new Set<string>();
  page.on("console", (message) => {
    if (/content.security.policy/i.test(message.text())) consoleCsp.push(message.text());
  });
  context.on("request", (req) => {
    const url = new URL(req.url());
    if (url.protocol.startsWith("http")) origins.add(url.origin);
  });
  return {
    /** Puts the hosts into `log`, then asserts that all of them are allowed and the console is clean. */
    check(log: Record<string, unknown>) {
      const own = new URL(page.url()).origin;
      const foreign = [...origins].filter((origin) => origin !== own).sort();
      log.hosts = foreign.map((origin) => ({ origin, allowed: allowedHost(origin) }));
      log.consoleCsp = consoleCsp;
      expect(consoleCsp).toEqual([]);
      expect(foreign.filter((origin) => !allowedHost(origin))).toEqual([]);
    },
  };
}

/** Opens a world, selects "Im Browser" and gets the model loaded (or finds it cached). */
async function prepareEngine(page: Page, log: Record<string, unknown>, worldId: string) {
  await page.goto(`/?world=${worldId}`);
  await expect(page.getByRole("toolbar", { name: "Manuskript" })).toBeVisible();

  log.adapter = await page.evaluate(async () => {
    const gpu = (navigator as { gpu?: { requestAdapter(o?: object): Promise<unknown> } }).gpu;
    if (!gpu) return { webgpu: false };
    const adapter = (await gpu.requestAdapter({ powerPreference: "high-performance" })) as {
      info?: { vendor?: string; architecture?: string; isFallbackAdapter?: boolean };
      isFallbackAdapter?: boolean;
    } | null;
    if (!adapter) return { webgpu: true, adapter: null };
    return {
      webgpu: true,
      vendor: adapter.info?.vendor,
      architecture: adapter.info?.architecture,
      isFallbackAdapter: adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter ?? false,
    };
  });
  console.log(`[webllm-real-model] adapter ${JSON.stringify(log.adapter)}`);

  await page.getByRole("button", { name: "Lokalen Assistenten öffnen" }).click();
  const drawer = page.getByRole("complementary", { name: "Lokaler Assistent" });
  const browserEngine = drawer.getByRole("radio", { name: "Im Browser" });
  // Without a hardware adapter the product offers no "Im Browser" (the T-54 software-adapter
  // ban), and with a single engine the drawer shows no choice at all. The spec does not get
  // around the ban: that is the gap, named in the skip reason.
  const adapter = log.adapter as {
    architecture?: string;
    vendor?: string;
    isFallbackAdapter?: boolean;
    adapter?: null;
  };
  test.skip(
    (!adapter.vendor && !adapter.architecture) || adapter.isFallbackAdapter === true,
    `No hardware WebGPU adapter in this Chromium (try QUILTOR_WEBLLM_HEADED=1): ${JSON.stringify(adapter)}`,
  );
  await expect(browserEngine).toBeVisible();
  await browserEngine.check();
  await expect(browserEngine).toBeChecked();
  await expect(drawer.getByText("KI im Browser", { exact: true })).toBeVisible();

  // The panel first asks the cache ("Prüfe …"); only then does it offer the download.
  const started = Date.now();
  const download = drawer.getByRole("button", { name: "Modell herunterladen" });
  const cached = drawer.getByText(
    "Das Modell liegt auf diesem Gerät und wird beim ersten Auftrag geladen.",
  );
  await expect(download.or(cached)).toBeVisible({ timeout: 60_000 });
  log.cachedBefore = await cached.isVisible();
  // A model already in the profile (an earlier test, or QUILTOR_WEBLLM_PROFILE) is loaded by
  // the first job instead.
  if (!log.cachedBefore) await download.click();
  await expect(browserEngine).toBeChecked();
  if (!log.cachedBefore) {
    await expect(
      drawer.getByText("Das Modell ist geladen und rechnet auf diesem Gerät."),
    ).toBeVisible({ timeout: 45 * 60_000 });
  }
  log.loadSeconds = Math.round((Date.now() - started) / 1000);
  return { drawer, browserEngine };
}

// The three tests share one profile and run in order: the first fetches the model, the last
// removes it again.
test.describe.configure({ mode: "serial" });

test("The in-browser engine answers on an empty world with the real model under an enforced CSP", async ({
  page,
  context,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "One viewport is enough for a 2.5 GB download.");
  test.setTimeout(60 * 60_000);

  const log: Record<string, unknown> = { model: MODEL_ID, profile: PROFILE ?? "(temporary)" };
  lastLog = log;
  const network = watchNetwork(page, context);
  const world = await createTestWorld(page, "KI im Browser mit echtem Modell");
  await prepareEngine(page, log, world.id);

  // An empty world: there the model looks up ids that do not exist, and a "not found" once
  // ended the read step with the fallback text (T-61 diagnosis, D-218).
  log.empty = await askAndRead(page, request, world.id);
  network.check(log);
});

test("The in-browser engine answers on the example world with the real model", async ({
  page,
  context,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "One viewport is enough for a 2.5 GB download.");
  test.setTimeout(60 * 60_000);

  const log: Record<string, unknown> = { model: MODEL_ID, profile: PROFILE ?? "(temporary)" };
  lastLog = log;
  const network = watchNetwork(page, context);
  const world = await createTestWorld(page, "KI im Browser mit echtem Modell");
  const { browserEngine } = await prepareEngine(page, log, world.id);

  // The example world, so the answer has something to read.
  const seeded = await seedExampleWorld(page);
  await page.getByRole("button", { name: "Lokalen Assistenten öffnen" }).click();
  await expect(browserEngine).toBeChecked();
  log.seeded = await askAndRead(page, request, seeded.id);
  expect(
    (log.seeded as { names: string[] }).names.length,
    "the answer about the example world names none of its figures",
  ).toBeGreaterThan(0);
  network.check(log);
});

test("The in-browser engine removes the model and leaves no foreign host or CSP violation", async ({
  page,
  context,
}, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "One viewport is enough for a 2.5 GB download.");
  test.setTimeout(60 * 60_000);

  const log: Record<string, unknown> = { model: MODEL_ID, profile: PROFILE ?? "(temporary)" };
  lastLog = log;
  const network = watchNetwork(page, context);
  const world = await createTestWorld(page, "KI im Browser mit echtem Modell");
  const { drawer } = await prepareEngine(page, log, world.id);

  await drawer.getByRole("button", { name: "Modell entfernen" }).click();
  await expect(drawer.getByRole("button", { name: "Modell herunterladen" })).toBeVisible({
    timeout: 60_000,
  });
  // The empty webllm/{config,wasm,model} buckets stay; what counts is what they still hold.
  // The panel offers the download again before the deletion has quite finished, so poll.
  const cacheEntries = () =>
    page.evaluate(async () =>
      Promise.all(
        (await caches.keys())
          .filter((key) => key.startsWith("webllm"))
          .map(async (key) => ({
            cache: key,
            urls: (await (await caches.open(key)).keys()).map((entry) => entry.url),
          })),
      ),
    );
  let left: { cache: string; urls: string[] }[] = [];
  await expect
    .poll(
      async () => {
        left = (await cacheEntries()).filter((entry) => entry.urls.length > 0);
        return left.length;
      },
      { timeout: 60_000, intervals: [1_000] },
    )
    .toBe(0)
    .catch(() => {
      // Asserted after the CSP checks, so a leftover does not hide what they found.
    });
  log.cachedAfterRemove = left;
  log.storageAfterRemove = await page.evaluate(async () => {
    const estimate = await navigator.storage.estimate();
    return `${Math.round((estimate.usage ?? 0) / 1e6)} MB`;
  });

  network.check(log);
  // WebLLM 0.2.86's deleteModelAllInfoInCache leaves the model's tensor-cache.json behind
  // (measured: one entry, storage 0 MB). That index is a few kilobytes; the shards are gone.
  // Anything else left over fails, and so does storage that did not drop.
  const leftovers = left.flatMap((entry) => entry.urls);
  expect(
    leftovers.filter((url) => !url.endsWith("/tensor-cache.json")),
    "model cache after 'Modell entfernen'",
  ).toEqual([]);
  expect(log.storageAfterRemove).toBe("0 MB");
});
