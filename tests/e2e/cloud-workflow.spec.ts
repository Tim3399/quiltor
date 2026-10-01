import AxeBuilder from "@axe-core/playwright";
import { encodeManuscriptV1 } from "../../packages/client/src/platform/contracts/v1/manuscript";
import { encodeStoryWorldV1 } from "../../packages/client/src/platform/contracts/v1/storyWorld";
import { encodeStoryboardsV1 } from "../../packages/client/src/platform/contracts/v1/storyboards";
import { createTestWorld, expect, test } from "./support/world-fixture";

test("Unconfigured cloud leaves the actual local writing workflow available", async ({ page }) => {
  const world = await createTestWorld(page, `Ohne Cloud ${crypto.randomUUID()}`);
  await page.goto(`/?world=${world.id}`);
  await expect(page.getByRole("toolbar", { name: "Manuskript", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mehr", exact: true }).click();
  await page.getByRole("menuitem", { name: "Cloud-Synchronisation", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Cloud-Synchronisation", exact: true });
  await expect(dialog).toContainText("Keine Cloud eingerichtet");
  await expect(dialog).toContainText("ohne Cloud nutzbar");
  await expect(
    dialog.getByRole("button", { name: "Jetzt synchronisieren", exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Schließen", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("toolbar", { name: "Manuskript", exact: true })).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`Cloud conflict inspection and error recovery in ${theme} mode`, async ({
    page,
  }, testInfo) => {
    // Remote transport is stubbed for deterministic UI states. Independent Python tests
    // exercise real HTTP synchronization against separate local roots and the cloud server.
    const world = await createTestWorld(page, `Cloud-Vergleich ${crypto.randomUUID()}`);
    const local = {
      chapters: [
        {
          id: "anfang",
          title: "Anfang",
          body: "Meine lokale Fassung bleibt erhalten.",
          note: "Meine Notiz.",
        },
      ],
    };
    const saved = await page.request.put(`/api/manuscript?world=${world.id}`, {
      headers: { "If-Match": '"0"' },
      data: encodeManuscriptV1(local, 0),
    });
    expect(saved.ok(), await saved.text()).toBeTruthy();
    const baseline = await (await page.request.get(`/api/manuscript?world=${world.id}`)).json();
    const status = {
      ok: true,
      configured: true,
      endpoint: "https://cloud.example.test",
      mode: "manual",
      state: "conflict",
      localFingerprint: "a".repeat(64),
      baseGeneration: 1,
      remote: { generation: 2, snapshotId: "b".repeat(64) },
      lastSyncedAt: "2026-09-19T09:00:00Z",
      account: {
        accountId: "konto",
        access: "read-write",
        usedBytes: 1048576,
        limitBytes: 2097152,
        deleteAfter: null,
      },
    };
    await page.route("**/api/backup/login?*", (route) =>
      route.fulfill({
        json: {
          ok: true,
          configured: true,
          hosted: false,
          endpoint: status.endpoint,
          signedIn: true,
        },
      }),
    );
    await page.route("**/api/sync?*", (route) => route.fulfill({ json: status }));
    await page.route("**/api/sync/preview?*", (route) =>
      route.fulfill({
        json: {
          ok: true,
          generation: 2,
          snapshotId: status.remote.snapshotId,
          documents: {
            manuscript: encodeManuscriptV1(
              {
                chapters: [],
                trash: [
                  {
                    chapter: {
                      id: "anfang",
                      title: "Anfang",
                      body: "Die andere Fassung liegt im Papierkorb.",
                      note: "",
                    },
                    deletedAt: "2026-09-19T09:01:00Z",
                    originalFolderPath: [],
                    treeItem: {
                      id: "baum-anfang",
                      kind: "chapter",
                      chapterId: "anfang",
                      position: 0,
                    },
                  },
                ],
              },
              1,
            ),
            figures: encodeStoryWorldV1({ nodes: [], edges: [] }, 0),
            storyboards: encodeStoryboardsV1(
              {
                boards: [{ id: "haupttafel", title: "Haupthandlung" }],
                nodes: [],
                edges: [],
              },
              0,
            ),
          },
        },
      }),
    );
    let submitted: unknown = null;
    await page.route("**/api/sync", (route) => {
      submitted = route.request().postDataJSON();
      return route.fulfill({
        status: 507,
        json: { ok: false, error: { code: "cloud.quota_exceeded", params: {}, retryable: false } },
      });
    });
    await page.goto(`/?world=${world.id}`);
    await expect(page.getByLabel("Kapiteltext")).toContainText(local.chapters[0].body);
    const currentTheme = await page.locator("html").getAttribute("data-theme");
    if (currentTheme !== theme) {
      await page.getByRole("button", { name: "Mehr", exact: true }).click();
      await page
        .getByRole("menuitem", { name: theme === "dark" ? "Dunkel" : "Hell", exact: true })
        .click();
    }
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.getByRole("button", { name: "Mehr", exact: true }).click();
    await page.getByRole("menuitem", { name: "Cloud-Synchronisation", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Cloud-Synchronisation", exact: true });
    const choose = dialog.getByRole("button", { name: "Lokale Fassung übernehmen", exact: true });
    await expect(choose).toBeDisabled();
    await dialog
      .getByRole("button", { name: "Cloud-Fassung zum Vergleich laden", exact: true })
      .click();
    await expect(choose).toBeEnabled();
    await dialog.getByText("Anfang · Im Papierkorb", { exact: true }).click();
    await expect(dialog).toContainText("Die andere Fassung liegt im Papierkorb.");
    await dialog.evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => undefined)),
      );
    });
    const axe = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(axe.violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`cloud-conflict-${theme}.png`) });
    await choose.click();
    const confirmation = page.getByRole("alertdialog", {
      name: "Lokale Fassung übernehmen",
      exact: true,
    });
    await confirmation
      .getByRole("button", { name: "Diese Fassung übernehmen", exact: true })
      .click();
    await expect(dialog).toContainText("Der Cloud-Speicher ist voll.");
    expect(submitted).toEqual({
      worldId: world.id,
      action: "keep-local",
      expectedGeneration: 2,
      expectedLocalFingerprint: status.localFingerprint,
    });
    expect(await (await page.request.get(`/api/manuscript?world=${world.id}`)).json()).toEqual(
      baseline,
    );
    await expect(choose).toBeDisabled();
    await dialog.getByRole("button", { name: "Schließen", exact: true }).click();
    await expect(page.getByLabel("Kapiteltext")).toContainText(local.chapters[0].body);
  });
}
