import type { Page } from "@playwright/test";
import { encodeManuscriptV1 } from "../../packages/client/src/platform/contracts/v1/manuscript";
import { createTestWorld, expect, test } from "./support/world-fixture";

// T-69: nothing typed before a chapter has loaded can be lost or misplaced, and a load never
// replaces unsaved text silently. The tests below guard both rules and the edits they must
// leave alone.

function chapterText(page: Page) {
  return page.getByRole("textbox", { name: "Kapiteltext" });
}

async function seededWorld(page: Page, body: string) {
  const world = await createTestWorld(page, `Ladeschutz ${crypto.randomUUID()}`);
  const response = await page.request.put(`/api/manuscript?world=${world.id}`, {
    headers: { "If-Match": '"0"' },
    data: encodeManuscriptV1({ chapters: [{ id: "opening", title: "Anfang", body, note: "" }] }, 0),
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return world;
}

async function savedBody(page: Page, worldId: string) {
  const response = await page.request.get(`/api/manuscript?world=${worldId}`);
  return (await response.json()).payload.chapters[0].body as string;
}

function manuscriptPut(page: Page, status: number) {
  return page.waitForResponse(
    (response) =>
      response.url().includes("/api/manuscript?") &&
      response.request().method() === "PUT" &&
      response.status() === status,
  );
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

test("Undo after bold returns to the saved text (P-a)", async ({ page }) => {
  const world = await seededWorld(page, "Hallo Welt");
  await page.goto(`/?world=${world.id}`);
  await expect(chapterText(page)).toHaveText("Hallo Welt");
  const saved = manuscriptPut(page, 200);
  await chapterText(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" und mehr");
  await saved;
  // The autosave must not interrupt writing: the same editor keeps the caret.
  await expect(chapterText(page)).toBeFocused();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Control+B");
  await page.keyboard.press("Control+Z");
  await page.keyboard.press("Control+Z");
  await expect(chapterText(page)).toHaveText("Hallo Welt");
});

test("A grammar replacement right after typing is kept and saved (P-c)", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "The writing aid sits beside the text when wide.");
  const world = await seededWorld(page, "Hallo Wlt");
  await page.route("**/api/writing-assistance/status", (route) =>
    route.fulfill({
      json: {
        ok: true,
        installed: true,
        stale: false,
        version: "test",
        sources: {},
        grammar: {
          supported: true,
          unsupportedReason: "",
          available: true,
          installed: true,
          running: true,
          version: "6.6",
          javaVersion: 17,
          javaRequired: 17,
          externalConfigured: false,
          externalEnabled: false,
          download: { url: "", checksum: "", license: "LGPL" },
        },
      },
    }),
  );
  await page.route("**/api/writing-assistance/check", (route) =>
    route.fulfill({
      json: {
        ok: true,
        language: "de-DE",
        issues: [
          {
            id: "wlt",
            from: 6,
            to: 9,
            ruleId: "SPELL",
            category: "Rechtschreibung",
            message: "Möglicher Tippfehler",
            replacements: ["Welt"],
          },
        ],
      },
    }),
  );
  await page.goto(`/?world=${world.id}`);
  await expect(chapterText(page)).toHaveText("Hallo Wlt");
  await chapterText(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" und mehr");
  await page.getByRole("radio", { name: "Schreibhilfe", exact: true }).click();
  await page.getByRole("tab", { name: "Prüfen", exact: true }).click();
  await page.getByRole("button", { name: "Text prüfen", exact: true }).click();
  await page.getByRole("button", { name: "Wlt" }).click();
  const saved = manuscriptPut(page, 200);
  await page.getByRole("button", { name: "Welt", exact: true }).click();
  await expect(chapterText(page)).toHaveText("Hallo Welt und mehr");
  await saved;
  await expect.poll(() => savedBody(page, world.id)).toBe("Hallo Welt und mehr");
});

for (const pending of [false, true]) {
  test(`Adopting the saved version wins in a two-tab conflict${pending ? " over pending input (P-d)" : " (P-b)"}`, async ({
    page,
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "wide", "Two wide browser pages.");
    const world = await seededWorld(page, "Erste Fassung.");
    const second = await context.newPage();
    try {
      await Promise.all([page.goto(`/?world=${world.id}`), second.goto(`/?world=${world.id}`)]);
      await expect(chapterText(page)).toHaveText("Erste Fassung.");
      await expect(chapterText(second)).toHaveText("Erste Fassung.");

      const firstSaved = manuscriptPut(page, 200);
      await chapterText(page).click();
      await page.keyboard.press("Control+End");
      await page.keyboard.type(" Sitzung A.");
      await firstSaved;

      const conflicted = manuscriptPut(second, 409);
      await chapterText(second).click();
      await second.keyboard.press("Control+End");
      await second.keyboard.type(" Sitzung B.");
      await second.keyboard.press("Control+A");
      await second.keyboard.press("Control+B");
      await conflicted;
      if (pending) {
        await second.keyboard.press("Control+End");
        await second.keyboard.type(" Noch ungespeichert.");
      }

      await second.getByRole("button", { name: "Entwurf retten", exact: true }).click();
      const recovery = second.getByRole("dialog", { name: "Ungespeicherten Entwurf retten" });
      await recovery
        .getByRole("button", { name: "Gespeicherte Fassung laden", exact: true })
        .click();
      await expect(recovery).toContainText("Sitzung A.");
      const downloaded = second.waitForEvent("download");
      await recovery
        .getByRole("button", { name: "Beide Fassungen als JSON herunterladen", exact: true })
        .click();
      await downloaded;
      const adopt = recovery.getByRole("button", {
        name: "Gespeicherte Fassung übernehmen",
        exact: true,
      });
      await expect(adopt).toBeEnabled();
      await adopt.click();
      await expect(recovery).toHaveCount(0);
      await expect(chapterText(second)).toHaveText("Erste Fassung. Sitzung A.");
      await second.waitForTimeout(1200);
      expect(await savedBody(page, world.id)).toBe("Erste Fassung. Sitzung A.");
    } finally {
      await second.close();
    }
  });
}
