import type { Page } from "@playwright/test";
import { encodeManuscriptV1 } from "../../packages/client/src/platform/contracts/v1/manuscript";
import { openToolbarOverflow } from "./support/toolbar-overflow";
import { createTestWorld, expect, test } from "./support/world-fixture";

// F-85-3: the chapter panel "Versionen" in both themes, over a real snapshot. The images are
// written to the test output for a person to look at; baselines are part E's (CLAUDE.md).

async function saveText(page: Page, world: string, body: string) {
  const endpoint = `/api/manuscript?world=${world}`;
  const current = await page.request.get(endpoint);
  expect(current.ok()).toBe(true);
  const revision = current.headers().etag;
  expect(revision).toBeTruthy();
  const saved = await page.request.put(endpoint, {
    headers: { "If-Match": revision },
    data: encodeManuscriptV1(
      { chapters: [{ id: "anfang", title: "Ankunft am Hafen", body, note: "" }] },
      Number(revision.replaceAll('"', "")),
    ),
  });
  expect(saved.ok(), await saved.text()).toBe(true);
}

for (const theme of ["light", "dark"] as const) {
  test(`The chapter versions panel names versions by date and stays readable in ${theme} mode`, async ({
    page,
  }, testInfo) => {
    const world = await createTestWorld(page, "Kapitelversionen");
    await saveText(page, world.id, "Der Morgen lag still über dem Hafen.");
    const snapshot = await page.request.post("/api/backup", {
      data: { worldId: world.id, message: "Vor der Überarbeitung", push: false },
    });
    expect(snapshot.ok(), await snapshot.text()).toBe(true);
    await saveText(page, world.id, "Der Morgen lag still über dem Hafen. Niemand winkte.");

    await page.goto(`/?world=${world.id}`);
    await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
    await page
      .locator("html")
      .evaluate((root, selected) => root.setAttribute("data-theme", selected), theme);
    await openToolbarOverflow(page, "Manuskript", "Versionen");
    const panel = page.getByRole("complementary", { name: "Versionen" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Frühere Version", { exact: true })).toBeVisible();

    // The version carries a German date to the minute and the author's note, never an ISO stamp.
    const field = panel.getByRole("combobox", { name: "Version" });
    const name = await field.locator("option:checked").textContent();
    expect(name).toMatch(/^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2} · Vor der Überarbeitung$/);
    expect(name).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    await expect(panel).not.toContainText("Fassung");

    const geometry = await panel.evaluate((element) => ({
      width: element.clientWidth,
      scroll: element.scrollWidth,
      right: element.getBoundingClientRect().right,
      viewport: window.innerWidth,
    }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1);
    await panel.screenshot({ path: testInfo.outputPath(`chapter-versions-${theme}.png`) });
  });
}
