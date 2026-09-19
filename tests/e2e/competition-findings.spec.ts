import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { encodeManuscriptV1 } from "../../packages/client/src/platform/contracts/v1/manuscript";
import { createTestWorld, expect, registerTestWorld, test } from "./support/world-fixture";

async function seedManuscript(page: Page, worldId: string) {
  const response = await page.request.put(`/api/manuscript?world=${worldId}`, {
    headers: { "If-Match": '"0"' },
    data: encodeManuscriptV1(
      { chapters: [{ id: "opening", title: "Anfang", body: "Erste Fassung.", note: "Notiz." }] },
      0,
    ),
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function openBinder(page: Page) {
  await expect(page.getByRole("toolbar", { name: "Manuskript", exact: true })).toBeVisible();
  if (!(await page.getByRole("button", { name: "Papierkorb", exact: true }).isVisible())) {
    await page.getByRole("button", { name: "Kapitel", exact: true }).click();
  }
}

test("Backup preview exposes storage and restore preserves the newer saved content", async ({
  page,
}, testInfo) => {
  const world = await createTestWorld(page, `Sicherung ${crypto.randomUUID()}`);
  await seedManuscript(page, world.id);
  const before = await (await page.request.get(`/api/manuscript?world=${world.id}`)).json();
  const list = await (await page.request.get(`/api/backups?world=${world.id}`)).json();
  expect(list.backups.length).toBeGreaterThan(0);
  const expectedPreview = await (
    await page.request.get(
      `/api/backups/preview?world=${world.id}&name=${encodeURIComponent(list.backups[0].name)}`,
    )
  ).json();
  await page.goto(`/?world=${world.id}`);
  await expect(page.getByLabel("Kapiteltext")).toContainText("Erste Fassung.");
  await page.getByRole("button", { name: "Mehr", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sicherungen", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Sicherungen", exact: true });
  await expect(sheet).toContainText("Datenbankdatei");
  await expect(sheet).toContainText("Letzte erfolgreiche Sicherung");
  await expect(
    sheet.getByRole("button", { name: "Sicherung wiederherstellen", exact: true }),
  ).toHaveCount(0);
  await sheet.locator(".backup-list-item").first().click();
  await expect(
    sheet.getByRole("button", { name: "Sicherung wiederherstellen", exact: true }),
  ).toBeEnabled();
  const accessibility = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("backup-preview.png") });
  const current = await (await page.request.get(`/api/manuscript?world=${world.id}`)).json();
  expect(current).toEqual(before);
  await sheet.getByRole("button", { name: "Sicherung wiederherstellen", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", {
    name: "Sicherung wiederherstellen",
    exact: true,
  });
  const confirmed = page.waitForResponse(
    (response) => response.url().endsWith("/api/backups/restore") && response.status() === 200,
  );
  const hold = confirmation.getByRole("button", {
    name: "Sicherung wiederherstellen – gedrückt halten zum Bestätigen",
    exact: true,
  });
  await hold.focus();
  await page.keyboard.down("Space");
  await confirmed;
  await page.keyboard.up("Space");
  await expect(sheet).toHaveCount(0);
  const restored = await (await page.request.get(`/api/manuscript?world=${world.id}`)).json();
  expect(restored.payload).toEqual(expectedPreview.documents.manuscript.payload);
  expect(restored.revision).toBeGreaterThan(before.revision);
  const afterList = await (await page.request.get(`/api/backups?world=${world.id}`)).json();
  const recent = await (
    await page.request.get(
      `/api/backups/preview?world=${world.id}&name=${encodeURIComponent(afterList.backups[0].name)}`,
    )
  ).json();
  expect(recent.documents.manuscript.payload).toEqual(before.payload);
});

test("Set-aside chapters remain editable and survive trash, reload and restore", async ({
  page,
}) => {
  const world = await createTestWorld(page, `Entwurf ${crypto.randomUUID()}`);
  await seedManuscript(page, world.id);
  await page.goto(`/?world=${world.id}`);
  await expect(page.getByLabel("Kapiteltext")).toContainText("Erste Fassung.");
  await openBinder(page);
  await page.getByRole("button", { name: "Kapitelaktionen: Anfang", exact: true }).click();
  await page.getByRole("menuitem", { name: "Aus dem Buch nehmen", exact: true }).click();
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/manuscript?world=${world.id}`);
      return (await response.json()).payload.chapters[0].inBook;
    })
    .toBe(false);
  await page.reload();
  await expect(page.getByLabel("Kapiteltext")).toContainText("Erste Fassung.");
  await openBinder(page);
  await page.getByRole("button", { name: "Zurückgestellt", exact: true }).click();
  await page.getByRole("button", { name: "Kapitelaktionen: Anfang", exact: true }).click();
  await page.getByRole("menuitem", { name: "Kapitel löschen", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Kapitel löschen", exact: true })
    .click();
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/manuscript?world=${world.id}`);
      return (await response.json()).payload.trash?.length;
    })
    .toBe(1);
  await page.reload();
  await openBinder(page);
  await page.getByRole("button", { name: "Papierkorb", exact: true }).click();
  const trash = page.getByRole("dialog", { name: "Papierkorb", exact: true });
  await expect(trash).toContainText("Erste Fassung.");
  await trash.getByRole("textbox").fill("Erste Fassung");
  await trash.getByRole("button", { name: "Kapitel wiederherstellen", exact: true }).click();
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/manuscript?world=${world.id}`);
      const manuscript = (await response.json()).payload;
      return { chapter: manuscript.chapters[0], trash: manuscript.trash?.length ?? 0 };
    })
    .toMatchObject({
      chapter: { id: "opening", body: "Erste Fassung.", note: "Notiz.", inBook: false },
      trash: 0,
    });
});

test("Project trash remains accessible after reload and restores the same manuscript", async ({
  page,
}) => {
  const world = await createTestWorld(page, `Papierkorb ${crypto.randomUUID()}`);
  await seedManuscript(page, world.id);
  await page.goto("/");
  await page.getByRole("button", { name: `${world.title} – Welt löschen`, exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "In Papierkorb verschieben", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: `${world.title} – Welt öffnen`, exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Rückgängig", exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Papierkorb", exact: true }).click();
  const trash = page.getByRole("dialog", { name: "Papierkorb", exact: true });
  const item = trash.locator("li").filter({ hasText: world.title });
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: "Wiederherstellen", exact: true }).click();
  await expect(item).toHaveCount(0);
  await trash.getByRole("button", { name: "Schließen", exact: true }).click();
  await page.getByRole("button", { name: `${world.title} – Welt öffnen`, exact: true }).click();
  await expect(page.getByLabel("Kapiteltext")).toContainText("Erste Fassung.");
  const loaded = await page.request.get(`/api/manuscript?world=${world.id}`);
  expect((await loaded.json()).payload.chapters[0].id).toBe("opening");
});

test("Two real sessions preserve both drafts before resolving a stale write", async ({
  page,
  context,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Revision recovery is exercised with two wide browser pages.",
  );
  const world = await createTestWorld(page, `Konflikt ${crypto.randomUUID()}`);
  await seedManuscript(page, world.id);
  const second = await context.newPage();
  try {
    await Promise.all([page.goto(`/?world=${world.id}`), second.goto(`/?world=${world.id}`)]);
    await expect(page.getByLabel("Kapiteltext")).toContainText("Erste Fassung.");
    await expect(second.getByLabel("Kapiteltext")).toContainText("Erste Fassung.");
    const firstSaved = page.waitForResponse(
      (response) =>
        response.url().includes("/api/manuscript?") &&
        response.request().method() === "PUT" &&
        response.status() === 200,
    );
    await page.getByLabel("Kapiteltext").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" Sitzung A.");
    await firstSaved;
    const conflicted = second.waitForResponse(
      (response) =>
        response.url().includes("/api/manuscript?") &&
        response.request().method() === "PUT" &&
        response.status() === 409,
    );
    await second.getByLabel("Kapiteltext").click();
    await second.keyboard.press("Control+End");
    await second.keyboard.type(" Sitzung B.");
    await conflicted;
    await expect(second.getByLabel("Kapiteltext")).toContainText("Sitzung B.");
    await second.getByRole("button", { name: "Entwurf retten", exact: true }).click();
    const recovery = second.getByRole("dialog", { name: "Ungespeicherten Entwurf retten" });
    await recovery.getByRole("button", { name: "Gespeicherte Fassung laden", exact: true }).click();
    await expect(recovery).toContainText("Sitzung A.");
    await expect(recovery).toContainText("Sitzung B.");
    const keepLocal = recovery.getByRole("button", {
      name: "Meinen Entwurf als neue Fassung speichern",
      exact: true,
    });
    await expect(keepLocal).toBeDisabled();
    const downloaded = second.waitForEvent("download");
    await recovery
      .getByRole("button", { name: "Beide Fassungen als JSON herunterladen", exact: true })
      .click();
    const download = await downloaded;
    const path = await download.path();
    expect(path).not.toBeNull();
    const rescue = JSON.parse(await readFile(path!, "utf8"));
    expect(rescue.local.manuscript.chapters[0].body).toContain("Sitzung B.");
    expect(rescue.persisted.manuscript.chapters[0].body).toContain("Sitzung A.");
    await expect(keepLocal).toBeEnabled();
    await keepLocal.click();
    await expect(recovery).toHaveCount(0);
    const saved = await page.request.get(`/api/manuscript?world=${world.id}`);
    expect((await saved.json()).payload.chapters[0].body).toContain("Sitzung B.");
  } finally {
    await second.close();
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`Project transfer previews and opens an independent copy in ${theme} mode`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((value) => localStorage.setItem("quiltor-theme", value), theme);
    const world = await createTestWorld(page, `Transfer ${crypto.randomUUID()}`);
    const original = {
      chapters: [
        { id: "opening", title: "Anfang", body: "Erste Fassung.", note: "Notiz." },
        {
          id: "draft",
          title: "Alternative",
          body: "Aufgehobener Entwurf.",
          note: "",
          inBook: false,
        },
      ],
      trash: [
        {
          chapter: {
            id: "deleted",
            title: "Gelöschte Idee",
            body: "Weiterhin rettbar.",
            note: "Randnotiz.",
          },
          deletedAt: "2026-09-19T08:00:00Z",
          originalFolderPath: [],
          treeItem: {
            id: "tree-deleted",
            kind: "chapter" as const,
            chapterId: "deleted",
            position: 2,
          },
        },
      ],
    };
    const seeded = await page.request.put(`/api/manuscript?world=${world.id}`, {
      headers: { "If-Match": '"0"' },
      data: encodeManuscriptV1(original, 0),
    });
    expect(seeded.ok(), await seeded.text()).toBeTruthy();
    await page.goto(`/?world=${world.id}`);
    await expect(page.getByLabel("Kapiteltext")).toContainText("Erste Fassung.");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.getByRole("button", { name: "Mehr", exact: true }).click();
    await page.getByRole("menuitem", { name: "Erste Schritte", exact: true }).click();
    const guide = page.getByRole("dialog", { name: "Erste Schritte", exact: true });
    for (const title of [
      "Schreiben",
      "Manuskript übernehmen",
      "Figur nachschlagen",
      "Weltwissen vorbereiten",
    ]) {
      await expect(guide.getByRole("heading", { name: title, exact: true })).toBeVisible();
    }
    const guideAccessibility = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(guideAccessibility.violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`first-steps-${theme}.png`) });
    await page.keyboard.press("Escape");
    await expect(guide).toHaveCount(0);
    await page.getByRole("button", { name: "Mehr", exact: true }).click();
    await page.getByRole("menuitem", { name: "Projekt exportieren", exact: true }).click();
    const exportDialog = page.getByRole("dialog", {
      name: "Quiltor-Projekt exportieren",
      exact: true,
    });
    await expect(exportDialog).toContainText(
      "Versionsverlauf und Sicherungen sind nicht enthalten.",
    );
    const downloaded = page.waitForEvent("download");
    await exportDialog.getByRole("button", { name: "Projektdatei speichern", exact: true }).click();
    const archive = await downloaded;
    const path = await archive.path();
    expect(path).not.toBeNull();
    await expect(exportDialog).toHaveCount(0);
    await page.getByRole("button", { name: "Mehr", exact: true }).click();
    await page.getByRole("menuitem", { name: "Zur Weltauswahl", exact: true }).click();
    await page.getByRole("button", { name: "Projekt importieren", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Quiltor-Projekt importieren", exact: true });
    const confirm = dialog.getByRole("button", {
      name: "Als neues Projekt importieren",
      exact: true,
    });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel("Projektdatei").setInputFiles({
      name: "Projekt.quiltor",
      mimeType: "application/octet-stream",
      buffer: await readFile(path!),
    });
    await expect(confirm).toBeEnabled();
    await expect(dialog).toContainText(world.title);
    await expect(dialog).toContainText("Versionsverlauf und Sicherungen sind nicht enthalten.");
    await dialog.evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => undefined)),
      );
    });
    const accessibility = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`project-transfer-${theme}.png`) });
    const importedResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/project-transfer/import") &&
        response.request().method() === "POST",
    );
    await confirm.click();
    const imported = await (await importedResponse).json();
    registerTestWorld(page, imported.world.id);
    expect(imported.world.id).not.toBe(world.id);
    await expect(page.getByLabel("Kapiteltext")).toContainText("Erste Fassung.");
    const [source, copy] = await Promise.all([
      page.request.get(`/api/manuscript?world=${world.id}`),
      page.request.get(`/api/manuscript?world=${imported.world.id}`),
    ]);
    expect((await copy.json()).payload).toEqual((await source.json()).payload);
  });
}
