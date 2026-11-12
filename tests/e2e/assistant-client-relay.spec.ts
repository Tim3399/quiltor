import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page, Request, Route } from "@playwright/test";
import { ROOT } from "./support/python-process";
import { startTestHooksServer, type TestHooksServer } from "./support/test-hooks-server";
import { test as base, createTestWorld, expect } from "./support/world-fixture";

// A job on a browser engine, end to end against dist/ with the cspGuard (T-61 part 6, 8a).
//
// The engine is the cloud executor's test profile from T-61 part 8a: offered only when the
// server reports instance.testHooks, so the spec runs against a Quiltor of its own with
// QUILTOR_TEST_HOOKS=1 and QUILTOR_CSP=enforce (support/test-hooks-server.ts). The server on
// :8010 keeps running without them. Playwright answers the provider call through page.route;
// the relay between browser and server is real.
//
// baseURL comes from a worker fixture, not from beforeAll: createTestWorld and every other
// page.request must reach this server, not :8010.
const test = base.extend<object, { hooksServer: TestHooksServer }>({
  hooksServer: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright reads the dependencies from the pattern.
    async ({}, use) => {
      const server = await startTestHooksServer();
      try {
        await use(server);
      } finally {
        await server.stop();
      }
    },
    { scope: "worker", timeout: 120_000 },
  ],
  baseURL: async ({ hooksServer }, use) => use(hooksServer.url),
});

/** The world the last drawer opened on, so a failure report can ask for its status. */
let lastWorld = "";

// On a failure the report says what this server told the browser: CI runners differ.
test.afterEach(async ({ hooksServer, request }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const read = async (path: string) => {
    try {
      const response = await request.get(path);
      return `${response.status()} ${await response.text()}`;
    } catch (error) {
      return String(error);
    }
  };
  const report = [
    `server: ${hooksServer.url}`,
    `capabilities: ${await read("/api/capabilities")}`,
    `local assistant status: ${await read(`/api/assistant/status?world=${lastWorld}`)}`,
    `server output:\n${hooksServer.output()}`,
  ].join("\n");
  console.log(`[assistant-client-relay] ${testInfo.title}\n${report}`);
  await testInfo.attach("test-hooks-server", { body: report, contentType: "text/plain" });
});

const POLICY = JSON.parse(
  readFileSync(join(ROOT, "src/quiltor/bootstrap/csp-policy.json"), "utf8"),
) as { testHooksOrigin: string };
const PROVIDER = `${POLICY.testHooksOrigin}/v1/chat/completions`;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "POST",
};
const RUNNING_ELSEWHERE =
  "In einem anderen Tab läuft schon ein Auftrag mit deiner eigenen Engine. Warte, bis er fertig ist.";

function isJobsPost(request: Request): boolean {
  return new URL(request.url()).pathname === "/api/assistant/jobs" && request.method() === "POST";
}

function completion(message: string) {
  return {
    status: 200,
    headers: CORS,
    json: {
      choices: [
        {
          message: {
            role: "assistant",
            content: JSON.stringify({
              action: "final",
              final: { message, citations: [], proposals: [] },
            }),
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    },
  };
}

/** Answers every provider call with `message`. */
async function provider(page: Page, message: string) {
  await page.unroute(PROVIDER);
  await page.route(PROVIDER, (route) =>
    route.request().method() === "OPTIONS"
      ? route.fulfill({ status: 204, headers: CORS })
      : route.fulfill(completion(message)),
  );
}

/** Holds every provider call open; the returned list fills as calls arrive. */
async function silentProvider(page: Page): Promise<Route[]> {
  const held: Route[] = [];
  await page.unroute(PROVIDER);
  await page.route(PROVIDER, (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: CORS });
    held.push(route);
  });
  return held;
}

async function openAssistant(page: Page, worldId: string): Promise<Locator> {
  lastWorld = worldId;
  await page.goto(`/?world=${worldId}`);
  await expect(page.getByRole("toolbar", { name: "Manuskript" })).toBeVisible();
  await page.getByRole("button", { name: "Lokalen Assistenten öffnen" }).click();
  const drawer =
    (page.viewportSize()?.width || 0) < 720
      ? page.getByRole("dialog", { name: "Lokaler Assistent" })
      : page.getByRole("complementary", { name: "Lokaler Assistent" });
  const ownKey = drawer.getByRole("radio", { name: "Eigener Schlüssel" });
  await expect(ownKey).toBeVisible();
  await ownKey.check();
  return drawer;
}

async function send(drawer: Locator, text: string) {
  await drawer.getByRole("textbox", { name: "Nachricht an den lokalen Assistenten" }).fill(text);
  await drawer.getByRole("button", { name: "Nachricht senden" }).click();
}

test("The answer of a browser engine appears in the conversation", async ({ page }) => {
  const world = await createTestWorld(page, "Eigene Engine antwortet");
  await provider(page, "Ada wohnt am Hafen.");
  const drawer = await openAssistant(page, world.id);
  const call = page.waitForRequest(
    (request) => request.url() === PROVIDER && request.method() === "POST",
  );
  const created = page.waitForRequest((request) => isJobsPost(request));
  await send(drawer, "Wo wohnt Ada?");
  // The executor names "openai", the provider the server accepts for the test profile.
  expect((await created).postDataJSON().engine).toEqual({ kind: "cloud", provider: "openai" });
  expect((await call).headers().authorization).toMatch(/^Bearer /);
  await expect(drawer.getByText("Ada wohnt am Hafen.")).toBeVisible();
});

test("A second tab with a running client job gets the 429 notice", async ({ page, context }) => {
  const world = await createTestWorld(page, "Eigene Engine in zwei Tabs");
  const held = await silentProvider(page);
  const first = await openAssistant(page, world.id);
  await send(first, "Wo wohnt Ada?");
  await expect.poll(() => held.length).toBe(1);

  const other = await context.newPage();
  try {
    // Another world, so the drawer does not pick up the first tab's job: the limit is per user.
    const elsewhere = await createTestWorld(page, "Eigene Engine im zweiten Tab");
    const second = await openAssistant(other, elsewhere.id);
    await send(second, "Und Bela?");
    await expect(second.getByText(RUNNING_ELSEWHERE)).toBeVisible();
  } finally {
    await other.close();
  }
  await first.getByRole("button", { name: "Anfrage abbrechen" }).click();
});

test("After a cancel a new job can start at once", async ({ page }) => {
  const world = await createTestWorld(page, "Eigene Engine abbrechen");
  const held = await silentProvider(page);
  const drawer = await openAssistant(page, world.id);
  await send(drawer, "Wo wohnt Ada?");
  await expect.poll(() => held.length).toBe(1);
  const cancelled = page.waitForResponse(
    (response) => response.url().includes("/api/assistant/job/cancel") && response.ok(),
  );
  await drawer.getByRole("button", { name: "Anfrage abbrechen" }).click();
  await cancelled;

  await provider(page, "Bela wohnt im Turm.");
  const created = page.waitForResponse((response) => isJobsPost(response.request()));
  await send(drawer, "Wo wohnt Bela?");
  expect((await created).status()).toBe(202);
  await expect(drawer.getByText("Bela wohnt im Turm.")).toBeVisible();
  await expect(drawer.getByText(RUNNING_ELSEWHERE)).toHaveCount(0);
});

test("Closing the tab lets the client job fail", async ({ page, request }) => {
  // The job waits for the browser to pick up its call: 20 seconds (DELIVER_SECONDS).
  test.setTimeout(120_000);
  const world = await createTestWorld(page, "Eigene Engine geschlossen");
  await provider(page, "Kommt nie an.");
  // The tab's relay polls never reach the server, so its call stays undelivered when it closes.
  // Aborted rather than held: a held request may still go out when the page closes.
  let polled = false;
  await page.route("**/api/assistant/relay/next*", (route) => {
    polled = true;
    return route.abort();
  });
  const drawer = await openAssistant(page, world.id);
  const created = page.waitForResponse((response) => isJobsPost(response.request()));
  await send(drawer, "Wo wohnt Ada?");
  const response = await created;
  expect(response.status()).toBe(202);
  const body = response.request().postDataJSON() as Record<string, unknown>;
  const jobId = ((await response.json()) as { job: { id: string } }).job.id;
  await expect.poll(() => polled).toBe(true);
  await page.close();

  await expect
    .poll(
      async () => {
        const job = await request.get(`/api/assistant/job?id=${jobId}&world=${world.id}`);
        return ((await job.json()) as { job: { status: string } }).job.status;
      },
      { timeout: 60_000, intervals: [1_000] },
    )
    .toBe("failed");

  // Nothing of the closed tab holds the slot: the next client job is taken at once, not 429.
  const next = await request.post("/api/assistant/jobs", {
    data: body,
    headers: { "Idempotency-Key": crypto.randomUUID() },
  });
  expect(next.status(), await next.text()).toBe(202);
  const nextId = ((await next.json()) as { job: { id: string } }).job.id;
  const cancel = await request.post("/api/assistant/job/cancel", {
    data: { id: nextId, worldId: world.id },
  });
  expect(cancel.ok(), await cancel.text()).toBeTruthy();
});
