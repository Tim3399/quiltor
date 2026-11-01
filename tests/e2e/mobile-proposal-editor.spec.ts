import type { Locator, Page } from "@playwright/test";
import type { FigureState } from "../../packages/client/src/modules/story-world";
import { mockRequiredWorldDocuments } from "./support/application-api";
import { createTestWorld, expect, test } from "./support/world-fixture";

// The compact project is a 390x844 phone; it gets a touch screen so the editor is
// driven by taps, the way it failed for authors. Wider projects keep their pointer.
test.use({ hasTouch: true });

const person = (id: string, name: string, x: number) => ({
  id,
  x,
  y: 120,
  type: "person" as const,
  name,
  label: "",
  sub: "",
});

const storyWorld: FigureState = {
  nodes: [person("ada", "Ada", 120), person("bela", "Bela", 320), person("cleo", "Cleo", 520)],
  edges: [],
  timeline: [],
  presence: [],
  timeSystem: {
    id: "primary",
    name: "Gregorianisch",
    kind: "gregorian",
    unit: "day",
    eraName: "",
    eraAbbreviation: "",
    epochTime: 0,
    epochYear: 2024,
    epochMonth: 1,
    epochDay: 1,
    epochWeekday: 0,
    displayFormat: "",
    months: [],
    weekdays: [],
  },
};

async function openAssistantWithProposal(page: Page) {
  await mockRequiredWorldDocuments(page, {
    manuscript: { chapters: [{ id: "chapter", title: "Prolog", body: "Nebel.", note: "" }] },
    storyWorld,
  });
  await page.route("**/api/assistant/status*", (route) =>
    route.fulfill({ json: { ok: true, available: true, mode: "local", reason: "", chunks: 0 } }),
  );
  await page.route("**/api/assistant/jobs", (route) =>
    route.fulfill({
      json: {
        ok: true,
        created: true,
        job: {
          id: "job-mobile-proposal-editor",
          status: "completed",
          error: "",
          errorType: "",
          cancelRequested: false,
          createdAt: "2026-10-25T12:00:00Z",
          result: {
            ok: true,
            message: "Ich habe eine Beziehung zwischen Ada und Bela vorbereitet.",
            sources: [],
            proposals: [
              {
                kind: "create_relationship",
                relationship: { from: "ada", to: "bela", label: "Vertrauen", directed: false },
              },
            ],
          },
        },
      },
    }),
  );
  const world = await createTestWorld(page, "Vorschlag mobil bearbeiten");
  await page.goto(`/?world=${world.id}`);
  await expect(page.getByRole("toolbar", { name: "Manuskript" })).toBeVisible();
  await page.getByRole("button", { name: "Lokalen Assistenten öffnen" }).click();
  const drawer =
    (page.viewportSize()?.width || 0) < 720
      ? page.getByRole("dialog", { name: "Lokaler Assistent" })
      : page.getByRole("complementary", { name: "Lokaler Assistent" });
  await drawer
    .getByRole("textbox", { name: "Nachricht an den lokalen Assistenten" })
    .fill("Verbinde Ada und Bela.");
  await drawer.getByRole("button", { name: "Nachricht senden" }).click();
  return drawer;
}

async function press(locator: Locator, touch: boolean) {
  if (touch) await locator.tap();
  else await locator.click();
}

test("the proposal editor stays operable above the assistant sheet", async ({ page }, testInfo) => {
  const touch = testInfo.project.name === "compact";
  const drawer = await openAssistantWithProposal(page);

  const edit = drawer.getByRole("button", { name: "Bearbeiten", exact: true });
  await press(edit, touch);
  const editor = page.getByRole("dialog", { name: "Bearbeiten" });
  await expect(editor).toBeVisible();
  // The editor is the topmost modal: it is reachable, and focus is held inside it.
  await expect(editor).not.toHaveAttribute("inert");
  await expect.poll(() => editor.evaluate((node) => !node.closest("[inert]"))).toBe(true);
  await expect
    .poll(() => editor.evaluate((node) => node.contains(document.activeElement)))
    .toBe(true);

  const from = editor.getByRole("combobox", { name: "Von" });
  await press(from, touch);
  await press(page.getByRole("option", { name: "Cleo" }), touch);
  await expect(from).toHaveText(/Cleo/);

  const to = editor.getByRole("combobox", { name: "Nach" });
  await press(to, touch);
  await press(page.getByRole("option", { name: "Ada" }), touch);
  await expect(to).toHaveText(/Ada/);

  // Tab cycles within the editor and never escapes into the sheet behind it.
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press("Tab");
    expect(await editor.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }

  await press(editor.getByRole("button", { name: "Änderung speichern" }), touch);
  await expect(editor).toHaveCount(0);
  // Focus returns to the control that opened the editor.
  await expect(edit).toBeFocused();

  await press(edit, touch);
  await expect(page.getByRole("dialog", { name: "Bearbeiten" })).toBeVisible();
  await expect(from).toHaveText(/Cleo/);
  await expect(to).toHaveText(/Ada/);
});

test("an unsaved proposal edit survives a switch across the compact breakpoint", async ({
  page,
}, testInfo) => {
  // The test drives the viewport itself, so one desktop-sized project covers it.
  test.skip(testInfo.project.name !== "regular", "resizes the viewport itself");
  const drawer = await openAssistantWithProposal(page);
  await drawer.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Bearbeiten" });
  const label = editor.getByRole("textbox", { name: "Bezeichnung" });
  await label.fill("Misstrauen");

  // Below 720 px the drawer turns into the modal sheet; the open editor and its draft stay,
  // and the editor is the topmost modal rather than inert inside the sheet.
  await page.setViewportSize({ width: 700, height: 900 });
  await expect(page.locator('[role="dialog"][aria-label="Lokaler Assistent"]')).toBeAttached();
  await expect(editor).toBeVisible();
  await expect.poll(() => editor.evaluate((node) => !node.closest("[inert]"))).toBe(true);
  await expect(label).toHaveValue("Misstrauen");

  // And back to the side panel.
  await page.setViewportSize({ width: 900, height: 760 });
  const panel = page.getByRole("complementary", { name: "Lokaler Assistent" });
  await expect(panel).toBeVisible();
  await expect(editor).toBeVisible();
  await expect(label).toHaveValue("Misstrauen");

  await editor.getByRole("button", { name: "Änderung speichern" }).click();
  await expect(editor).toHaveCount(0);
  await panel.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  await expect(label).toHaveValue("Misstrauen");
});
