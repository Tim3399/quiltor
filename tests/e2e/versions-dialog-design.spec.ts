import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { encodeManuscriptV1 } from "../../packages/client/src/platform/contracts/v1/manuscript";
import { createTestWorld, expect, test } from "./support/world-fixture";

// Each tab of "Versionen & Sicherungen" in both themes, plus the versions tab of an installation
// without device sync. The chapter panel has its own spec (chapter-versions-design.spec.ts). The
// images go to the test output for a person to look at; they are not baselines.

const DIALOG = "Versionen & Sicherungen";

const tabs = [
  {
    name: "Versionen",
    ready: "Vor der Überarbeitung",
    explanation:
      "Eine Version hältst du selbst fest, mit einer kurzen Notiz. Du kannst sie jederzeit vergleichen oder wiederherstellen.",
  },
  {
    name: "Automatische Sicherungen",
    ready: "Letzte erfolgreiche Sicherung",
    explanation:
      "Quiltor sichert dein Projekt beim Speichern automatisch, höchstens alle 5 Minuten. Die letzten 40 Sicherungen bleiben erhalten.",
  },
  {
    name: "Mit anderen Geräten abgleichen",
    ready: "Noch kein Abgleich eingerichtet.",
    explanation:
      "Der Abgleich überträgt deine Versionen zu einem Server, damit du auf anderen Geräten weiterschreiben kannst. Er startet nur, wenn du ihn auslöst.",
  },
] as const;

async function openDialog(page: Page, theme: "light" | "dark", syncAvailable: boolean) {
  await page.route("**/api/whoami", async (route) => {
    const response = await route.fetch();
    const body = await response.json().catch(() => ({ ok: false }));
    await route.fulfill({ response, json: { ...body, syncAvailable } });
  });
  const world = await createTestWorld(page, `Versionen gestalten ${crypto.randomUUID()}`);
  const saved = await page.request.put(`/api/manuscript?world=${world.id}`, {
    headers: { "If-Match": '"0"' },
    data: encodeManuscriptV1(
      {
        chapters: [
          { id: "anfang", title: "Ankunft am Hafen", body: "Der Morgen lag still.", note: "" },
        ],
      },
      0,
    ),
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  const held = await page.request.post("/api/backup", {
    data: { worldId: world.id, message: "Vor der Überarbeitung", push: false },
  });
  expect(held.ok(), await held.text()).toBe(true);
  await page.goto(`/?world=${world.id}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await page
    .locator("html")
    .evaluate((root, selected) => root.setAttribute("data-theme", selected), theme);
  await page.getByRole("button", { name: "Mehr", exact: true }).click();
  await page.getByRole("menuitem", { name: DIALOG, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: DIALOG, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function expectContained(page: Page, dialog: Locator) {
  // The sheet slides and fades in, and a button under the pointer fades its colour; measured
  // mid-way either one sticks out or fails contrast. The design gallery stops transitions the same way.
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" });
  // Poll the visible state rather than awaiting `finished`: Chromium never resolves it for a
  // transition inside a closed <details> (see cloud-workflow.spec.ts, T-87 F1).
  await expect
    .poll(() =>
      dialog.evaluate(
        (element) =>
          element
            .getAnimations({ subtree: true })
            .filter((animation) => animation.pending || animation.playState === "running").length,
      ),
    )
    .toBe(0);
  const geometry = await dialog.evaluate((element) => ({
    width: element.clientWidth,
    scroll: element.scrollWidth,
    left: element.getBoundingClientRect().left,
    right: element.getBoundingClientRect().right,
    viewport: window.innerWidth,
  }));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.left).toBeGreaterThanOrEqual(-1);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1);
  const accessibility = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
}

for (const theme of ["light", "dark"] as const) {
  for (const tab of tabs) {
    test(`The ${tab.name} tab explains itself and fits in ${theme} mode`, async ({
      page,
    }, testInfo) => {
      const dialog = await openDialog(page, theme, true);
      await dialog.getByRole("tab", { name: tab.name, exact: true }).click();
      await expect(dialog.getByRole("tab", { name: tab.name, exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(dialog).toContainText(tab.ready);
      await expect(dialog.getByText("Cloud-Stand wird geprüft …")).toHaveCount(0);
      await expectContained(page, dialog);
      await dialog.screenshot({
        path: testInfo.outputPath(`versions-dialog-${tab.name}-${theme}.png`),
      });
    });
  }

  test(`Without device sync the dialog shows two tabs in ${theme} mode`, async ({
    page,
  }, testInfo) => {
    const dialog = await openDialog(page, theme, false);
    await expect(dialog.getByRole("tab")).toHaveText(["Versionen", "Automatische Sicherungen"]);
    await expect(dialog).toContainText(tabs[0].ready);
    await expectContained(page, dialog);
    await dialog.screenshot({
      path: testInfo.outputPath(`versions-dialog-without-sync-${theme}.png`),
    });
  });
}

for (const tab of tabs) {
  test(`The ${tab.name} tab opens with its explanation from plan 2.2`, async ({ page }) => {
    const dialog = await openDialog(page, "light", true);
    await dialog.getByRole("tab", { name: tab.name, exact: true }).click();
    await expect(dialog.getByText(tab.explanation, { exact: true })).toBeVisible();
  });
}
