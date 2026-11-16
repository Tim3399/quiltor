import { type CloudEndpoint, startCloudEndpoint } from "./support/cloud-endpoint";
import { createTestWorld, expect, test as base } from "./support/world-fixture";

/**
 * The sync flow against a real endpoint, with no route stubbed (T-164, D-87).
 *
 * cloud-workflow.spec.ts and versions-and-backups.spec.ts stub /api/sync, so a request the
 * server cannot read passes there: the missing Content-Type survived from 3.20.0 to 3.26
 * because no test ever sent the request to a server. This one does, end to end: browser,
 * a second Quiltor instance, the reference backup server. See support/cloud-endpoint.ts.
 */
const test = base.extend<object, { cloud: CloudEndpoint }>({
  cloud: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright reads the dependencies from the pattern.
    async ({}, use) => {
      const cloud = await startCloudEndpoint();
      try {
        await use(cloud);
      } finally {
        await cloud.stop();
      }
    },
    { scope: "worker", timeout: 120_000 },
  ],
  baseURL: async ({ cloud }, use) => use(cloud.quiltorUrl),
});

test("Setting the sync target and syncing now reach a real endpoint", async ({ page, cloud }) => {
  const { id: worldId } = await createTestWorld(page, `Echter Abgleich ${crypto.randomUUID()}`);
  const saved = await page.request.put(`/api/manuscript?world=${worldId}`, {
    headers: { "If-Match": '"0"' },
    data: {
      contract: "quiltor.manuscript",
      version: 1,
      revision: 0,
      payload: {
        chapters: [
          {
            id: "hafen",
            title: "Hafen",
            body: "Der Morgen lag still über dem Hafen.",
            note: "",
          },
        ],
      },
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();

  await page.goto(`/?world=${worldId}`);
  await expect(page.getByRole("toolbar", { name: "Manuskript", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mehr", exact: true }).click();
  await page.getByRole("menuitem", { name: "Versionen & Sicherungen", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Versionen & Sicherungen", exact: true });
  await dialog.getByRole("tab", { name: "Mit anderen Geräten abgleichen", exact: true }).click();

  // Setting up: the real POST /api/sync/target, the first of the two JSON bodies of D-87.
  await expect(dialog).toContainText("Noch kein Abgleich eingerichtet.");
  await dialog.getByLabel("Adresse des Servers").fill(cloud.endpointUrl);
  const stored = page.waitForResponse(
    (response) =>
      response.url().includes("/api/sync/target") && response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Abgleich einrichten", exact: true }).click();
  const storedResponse = await stored;
  expect(storedResponse.ok(), await storedResponse.text()).toBeTruthy();
  await expect(dialog).toContainText("Ziel gespeichert.");
  const target = await (await page.request.get(`/api/sync/target?world=${worldId}`)).json();
  expect(target).toMatchObject({ backupUrl: cloud.endpointUrl, source: "world" });

  // The sign-in is real too: the issuer hands out a code at once, the second instance
  // exchanges it at the callback and keeps the login.
  const popup = page.waitForEvent("popup");
  await dialog.getByRole("button", { name: "Bei der Sicherung anmelden", exact: true }).click();
  await (await popup).waitForLoadState();
  await dialog.getByRole("button", { name: "Status aktualisieren", exact: true }).click();

  // The second: POST /api/sync, answered by a server that reads a body only as JSON.
  const synced = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/sync" && response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Jetzt synchronisieren", exact: true }).click();
  const syncedResponse = await synced;
  expect(syncedResponse.ok(), await syncedResponse.text()).toBeTruthy();
  await expect(dialog.getByRole("status").filter({ hasText: "abgeglichen" })).toHaveText(
    "Projektstand mit der Cloud abgeglichen",
  );

  // What the endpoint holds, asked through the second instance: a first generation exists.
  const status = await (await page.request.get(`/api/sync?world=${worldId}`)).json();
  expect(status).toMatchObject({ ok: true, configured: true, state: "synced" });
  expect(status.remote.generation).toBeGreaterThanOrEqual(1);
});
