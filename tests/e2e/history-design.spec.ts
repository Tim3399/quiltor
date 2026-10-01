import type { Locator, Page } from "@playwright/test";
import { encodeManuscriptV1 } from "../../packages/client/src/platform/contracts/v1/manuscript";
import { createTestWorld, expect, test } from "./support/world-fixture";

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

async function openHistory(page: Page, world: string) {
  await page.goto(`/?world=${world}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await page.getByRole("button", { name: "Mehr", exact: true }).click();
  await page.getByRole("menuitem", { name: "Verlauf", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Verlauf", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function expectReadableWords(content: Locator) {
  const words = await content.locator("ins, del").evaluateAll((elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element);
      let ancestor: Element | null = element;
      let background = "";
      while (ancestor) {
        background = getComputedStyle(ancestor).backgroundColor;
        if (background !== "rgba(0, 0, 0, 0)" && background !== "transparent") break;
        ancestor = ancestor.parentElement;
      }
      const luminance = (color: string) => {
        const [r, g, b] = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((part) => {
          const channel = Number(part) / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const foregroundLuminance = luminance(style.color);
      const backgroundLuminance = luminance(background);
      return {
        text: element.textContent,
        contrast:
          (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
          (Math.min(foregroundLuminance, backgroundLuminance) + 0.05),
        marker:
          element.tagName === "INS"
            ? Number.parseFloat(style.borderBottomWidth) >= 2 && style.borderBottomStyle !== "none"
            : style.textDecorationLine.includes("line-through"),
      };
    }),
  );
  expect(words.length).toBeGreaterThanOrEqual(2);
  for (const word of words) {
    expect(word.contrast, `Contrast of ${word.text}`).toBeGreaterThanOrEqual(4.5);
    expect(word.marker, `Non-color marker of ${word.text}`).toBe(true);
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`History keeps real manuscript word changes readable in ${theme} mode`, async ({
    page,
  }, testInfo) => {
    const world = await createTestWorld(page, "Verlaufsprüfung");
    await saveText(
      page,
      world.id,
      "Der Morgen lag still über dem Hafen. Mara hielt den alten Brief fest.",
    );
    const snapshot = await page.request.post("/api/backup", {
      data: { worldId: world.id, message: "Vor der Überarbeitung", push: false },
    });
    expect(snapshot.ok(), await snapshot.text()).toBe(true);
    const revised =
      "Der Morgen lag still über dem Hafen. Mara hielt den ungeöffneten Brief fest. Niemand winkte.";
    await saveText(page, world.id, revised);
    const dialog = await openHistory(page, world.id);
    await page
      .locator("html")
      .evaluate((root, selected) => root.setAttribute("data-theme", selected), theme);
    const content = dialog.locator('.diff-segment[data-kind="chapter"] .diff-content');
    await expect(content.locator("ins").first()).toBeVisible();
    await expect(content).toHaveCSS("font-size", "16px");
    await expect(content).toHaveCSS("font-family", /EB Garamond/);
    await expectReadableWords(content);
    await expect
      .poll(async () =>
        dialog.evaluate(
          (element) => element.getBoundingClientRect().right <= window.innerWidth + 1,
        ),
      )
      .toBe(true);
    const geometry = await dialog.evaluate((element) => ({
      width: element.clientWidth,
      scroll: element.scrollWidth,
      right: element.getBoundingClientRect().right,
      viewport: window.innerWidth,
    }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1);
    await dialog.screenshot({ path: testInfo.outputPath(`history-${theme}.png`) });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Mehr", exact: true })).toBeFocused();
    await expect(page.getByLabel("Kapiteltext")).toContainText(revised);
  });

  test(`History wraps technical content with enlarged text in ${theme} mode`, async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name === "compact")
      await page.setViewportSize({ width: 320, height: 844 });
    const world = await createTestWorld(page, "Technischer Vergleich");
    const longLine = `pfad/${"sehr-langer-dateiname/".repeat(35)}`;
    await page.route("**/api/history/diff?*", (route) =>
      route.fulfill({
        json: {
          ok: true,
          diff: `diff --git a/config.json b/config.json\n@@ -1 +1 @@\n[-alter-]{+neuer+} Wert\n ${longLine}`,
          newFiles: [],
          mode: "word",
        },
      }),
    );
    const dialog = await openHistory(page, world.id);
    await page
      .locator("html")
      .evaluate((root, selected) => root.setAttribute("data-theme", selected), theme);
    const content = dialog.locator('.diff-segment[data-kind="other"] .diff-content');
    await expect(content).toHaveCSS("font-size", "14px");
    await expect(content).toHaveCSS("font-family", /monospace/);
    await expectReadableWords(content);
    await content.evaluate((element) => {
      element.style.fontSize = "28px";
    });
    const geometry = await content.evaluate((element) => ({
      width: element.clientWidth,
      scroll: element.scrollWidth,
    }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
    await dialog.screenshot({
      path: testInfo.outputPath(`history-technical-enlarged-${theme}.png`),
    });
  });
}
