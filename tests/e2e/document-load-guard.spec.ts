import type { Page } from "@playwright/test";
import { createTestWorld, expect, test } from "./support/world-fixture";

// T-69: nothing typed before a chapter has loaded can be lost or misplaced, because there is
// no editor to type into until the world's documents are in.

function chapterText(page: Page) {
  return page.getByRole("textbox", { name: "Kapiteltext" });
}

test("No editable chapter text exists while the manuscript is still loading (a′)", async ({
  page,
}) => {
  const world = await createTestWorld(page);
  await page.route("**/api/manuscript*", async (route) => {
    if (route.request().method() === "GET") await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });
  await page.goto(`/?world=${world.id}`);

  const started = Date.now();
  while (Date.now() - started < 1200) {
    await expect(chapterText(page)).toHaveCount(0);
    await page.waitForTimeout(100);
  }
  await expect(chapterText(page)).toBeVisible();
  await expect(chapterText(page)).toHaveAttribute("contenteditable", "true");
});
