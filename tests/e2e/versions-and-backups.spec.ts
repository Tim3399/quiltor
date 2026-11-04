import type { Page, Route } from "@playwright/test";
import { encodeManuscriptV1 } from "../../packages/client/src/platform/contracts/v1/manuscript";
import { createTestWorld, expect, test } from "./support/world-fixture";

const DIALOG = "Versionen & Sicherungen";

async function seedManuscript(page: Page, worldId: string, body: string) {
  const response = await page.request.put(`/api/manuscript?world=${worldId}`, {
    headers: { "If-Match": '"0"' },
    data: encodeManuscriptV1({ chapters: [{ id: "anfang", title: "Anfang", body, note: "" }] }, 0),
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function openWorld(page: Page, title: string, body = "Der Morgen lag still über dem Hafen.") {
  const world = await createTestWorld(page, `${title} ${crypto.randomUUID()}`);
  await seedManuscript(page, world.id, body);
  await page.goto(`/?world=${world.id}`);
  await expect(page.getByLabel("Kapiteltext")).toHaveText(body);
  return world;
}

async function openFromMenu(page: Page) {
  await page.getByRole("button", { name: "Mehr", exact: true }).click();
  await page.getByRole("menuitem", { name: DIALOG, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: DIALOG, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openPalette(page: Page) {
  await page.keyboard.press("Control+KeyK");
  await expect(page.getByRole("heading", { name: "Suchen & Befehle" })).toBeVisible();
}

/** Answers `/api/whoami` with the server's own reply, `syncAvailable` overridden. */
async function syncAvailability(page: Page, available: boolean) {
  await page.route("**/api/whoami", async (route: Route) => {
    const response = await route.fetch();
    const body = await response.json().catch(() => ({ ok: false }));
    await route.fulfill({ response, json: { ...body, syncAvailable: available } });
  });
}

test("The menu groups the actions and keeps none of the old entries", async ({ page }) => {
  await openWorld(page, "Menü");
  await page.getByRole("button", { name: "Mehr", exact: true }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Zur Weltauswahl",
    DIALOG,
    "Projekt exportieren",
    "Erste Schritte",
    /^(Dunkel|Hell)$/,
  ]);
  await expect(menu.getByRole("separator")).toHaveCount(2);
  for (const old of ["Verlauf", "Arbeitsstand sichern", "Sicherungen", "Cloud-Synchronisation"]) {
    await expect(menu.getByRole("menuitem", { name: old, exact: true })).toHaveCount(0);
  }
  // "Abmelden" only appears behind a login, which this suite has none of (D-T-87-A2).
});

test("A held version restores the exact earlier text and keeps the state it replaced", async ({
  page,
}) => {
  const original = "Der Morgen lag still über dem Hafen.";
  const changed = "Am Abend war der Hafen leer.";
  const world = await openWorld(page, "Versionen", original);
  const dialog = await openFromMenu(page);
  await expect(dialog.getByRole("tab", { name: "Versionen", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await dialog.getByLabel("Was hat sich geändert?").fill("Hafen am Morgen");
  await dialog.getByRole("button", { name: "Version festhalten", exact: true }).click();
  await expect(dialog).toContainText("Version festgehalten.");
  const states = dialog.getByRole("navigation", { name: "Stände" });
  const held = states.getByRole("button", { name: /· Hafen am Morgen/ });
  await expect(held).toHaveCount(1);
  // Holding on again without a change records nothing, says so and keeps the note.
  const stateCount = await states.getByRole("button").count();
  await dialog.getByLabel("Was hat sich geändert?").fill("Nochmal");
  await dialog.getByRole("button", { name: "Version festhalten", exact: true }).click();
  await expect(dialog).toContainText("Seit der letzten Version hat sich nichts geändert.");
  await expect(dialog.getByLabel("Was hat sich geändert?")).toHaveValue("Nochmal");
  await expect(states.getByRole("button")).toHaveCount(stateCount);
  await dialog.getByLabel("Was hat sich geändert?").fill("");
  await dialog.getByRole("button", { name: "Dialog schließen", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const editor = page.getByLabel("Kapiteltext");
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().includes(`/api/manuscript?world=${world.id}`) &&
      response.request().postData()?.includes(changed) === true,
  );
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(changed);
  expect((await saved).ok()).toBeTruthy();
  await expect(editor).toHaveText(changed);

  await openFromMenu(page);
  await states.getByRole("button", { name: /· Hafen am Morgen/ }).click();
  await dialog.getByRole("button", { name: "Diese Version wiederherstellen", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Version wiederherstellen" });
  const restored = page.waitForResponse(
    (response) => response.url().includes("/api/history/restore") && response.status() === 200,
  );
  await confirmation.getByRole("button", { name: "Wiederherstellen", exact: true }).click();
  await restored;
  await expect(dialog).toContainText("Version wiederhergestellt.");
  // The replaced state is a version of its own: the held one plus one more, named for what it is.
  await expect(states.getByRole("button")).toHaveCount(3);
  await expect(
    states.getByText(/^Vor Wiederherstellung, \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/),
  ).toHaveCount(1);
  const stored = await (await page.request.get(`/api/manuscript?world=${world.id}`)).json();
  expect(stored.payload.chapters.map((chapter: { body: string }) => chapter.body)).toEqual([
    original,
  ]);

  await dialog.getByRole("button", { name: "Quiltor neu laden", exact: true }).click();
  await expect(editor).toHaveText(original);
  const again = await openFromMenu(page);
  await expect(again.getByRole("navigation", { name: "Stände" }).getByRole("button")).toHaveCount(
    3,
  );
});

test("The automatic backups tab explains its interval and restores a backup", async ({ page }) => {
  const world = await openWorld(page, "Sicherungen");
  const list = await (await page.request.get(`/api/backups?world=${world.id}`)).json();
  expect(list.backups.length).toBeGreaterThan(0);
  const dialog = await openFromMenu(page);
  await dialog.getByRole("tab", { name: "Automatische Sicherungen", exact: true }).click();
  await expect(dialog).toContainText(
    "Quiltor sichert dein Projekt beim Speichern automatisch, höchstens alle 5 Minuten. Die letzten 40 Sicherungen bleiben erhalten.",
  );
  await expect(dialog).toContainText("Letzte erfolgreiche Sicherung");
  await dialog.locator(".backup-list-item").first().click();
  await dialog.getByRole("button", { name: "Sicherung wiederherstellen", exact: true }).click();
  const confirmed = page.waitForResponse(
    (response) => response.url().endsWith("/api/backups/restore") && response.status() === 200,
  );
  const hold = page
    .getByRole("alertdialog", { name: "Sicherung wiederherstellen", exact: true })
    .getByRole("button", {
      name: "Sicherung wiederherstellen – gedrückt halten zum Bestätigen",
      exact: true,
    });
  await hold.focus();
  await page.keyboard.down("Space");
  await confirmed;
  await page.keyboard.up("Space");
  await expect(dialog).toHaveCount(0);
});

test("The sync tab sets up a target and then shows it as set up", async ({ page }) => {
  // The remote side is stubbed as in cloud-workflow.spec.ts; the target itself is stored for real.
  const endpoint = "https://abgleich.example.test";
  let setUp = false;
  await page.route("**/api/backup/login?*", (route) =>
    setUp
      ? route.fulfill({ json: { ok: true, configured: true, endpoint, signedIn: true } })
      : route.continue(),
  );
  await page.route("**/api/sync?*", (route) =>
    setUp
      ? route.fulfill({
          json: {
            ok: true,
            configured: true,
            endpoint,
            mode: "manual",
            state: "synced",
            localFingerprint: "a".repeat(64),
            baseGeneration: 1,
            remote: { generation: 1, snapshotId: "b".repeat(64) },
            lastSyncedAt: "2026-11-01T13:40:00Z",
          },
        })
      : route.continue(),
  );
  const world = await openWorld(page, "Abgleich");
  const dialog = await openFromMenu(page);
  await dialog.getByRole("tab", { name: "Mit anderen Geräten abgleichen", exact: true }).click();
  await expect(dialog).toContainText("Noch kein Abgleich eingerichtet.");
  await expect(dialog).toContainText(
    "Ohne Abgleich bleibt alles nutzbar; Projekte lassen sich auch per Export übertragen.",
  );
  await dialog.getByLabel("Adresse des Servers").fill(endpoint);
  const stored = page.waitForResponse(
    (response) =>
      response.url().includes("/api/sync/target") && response.request().method() === "POST",
  );
  setUp = true;
  await dialog.getByRole("button", { name: "Abgleich einrichten", exact: true }).click();
  const storedResponse = await stored;
  expect(storedResponse.ok(), await storedResponse.text()).toBeTruthy();
  await expect(dialog).toContainText("Ziel gespeichert.");
  await expect(dialog).not.toContainText("Noch kein Abgleich eingerichtet.");
  await expect(dialog.getByRole("status").filter({ hasText: "abgeglichen" })).toHaveText(
    "Projektstand mit der Cloud abgeglichen",
  );
  await expect(dialog).toContainText(endpoint);
  await expect(
    dialog.getByRole("button", { name: "Jetzt synchronisieren", exact: true }),
  ).toBeVisible();
  const target = await (await page.request.get(`/api/sync/target?world=${world.id}`)).json();
  expect(target).toMatchObject({ backupUrl: endpoint, source: "world" });
});

test("Palette entries open their tab and the shortcut lands in the note field", async ({
  page,
}) => {
  await syncAvailability(page, true);
  await openWorld(page, "Palette");
  for (const [command, tab] of [
    ["Versionen öffnen", "Versionen"],
    ["Version festhalten", "Versionen"],
    ["Automatische Sicherungen öffnen", "Automatische Sicherungen"],
    ["Mit anderen Geräten abgleichen", "Mit anderen Geräten abgleichen"],
  ] as const) {
    await openPalette(page);
    await page
      .getByRole("dialog")
      .getByRole("option", { name: new RegExp(command) })
      .click();
    const dialog = page.getByRole("dialog", { name: DIALOG, exact: true });
    await expect(dialog.getByRole("tab", { name: tab, exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await dialog.getByRole("button", { name: "Dialog schließen", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  await page.getByLabel("Kapiteltext").click();
  await page.keyboard.press("ControlOrMeta+Shift+KeyS");
  const dialog = page.getByRole("dialog", { name: DIALOG, exact: true });
  await expect(dialog.getByRole("tab", { name: "Versionen", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(dialog.getByLabel("Was hat sich geändert?")).toBeFocused();
});

test("Without device sync there is no sync tab, palette entry or address field", async ({
  page,
}) => {
  await syncAvailability(page, false);
  await openWorld(page, "Gehostet");
  const dialog = await openFromMenu(page);
  await expect(dialog.getByRole("tab")).toHaveText(["Versionen", "Automatische Sicherungen"]);
  await dialog.getByRole("button", { name: "Dialog schließen", exact: true }).click();
  await openPalette(page);
  const palette = page.getByRole("dialog");
  await expect(palette.getByRole("option", { name: /Versionen öffnen/ })).toHaveCount(1);
  await expect(palette.getByRole("option", { name: /Mit anderen Geräten abgleichen/ })).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welt öffnen" })).toBeVisible();
  await page.getByRole("button", { name: "Neue Welt", exact: true }).click();
  await expect(page.getByLabel("Titel der Welt oder des Buches")).toBeVisible();
  await expect(page.getByLabel("Cloud-Backup (optional)")).toHaveCount(0);
});

test("With device sync the new world form asks for an address", async ({ page }) => {
  // Counterpart to the hosted case: the field is missing because of the flag, not by default.
  await syncAvailability(page, true);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welt öffnen" })).toBeVisible();
  await page.getByRole("button", { name: "Neue Welt", exact: true }).click();
  await expect(page.getByLabel("Cloud-Backup (optional)")).toBeVisible();
});
