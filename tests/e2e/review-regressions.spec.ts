import type { Page } from "@playwright/test";
import { encodeStoryWorldDocument, fulfillRevisionConflict } from "./support/application-api";
import { createTestWorld, expect, test } from "./support/world-fixture";

async function returnToWorldSelection(page: Page) {
  await page.getByRole("button", { name: "Mehr", exact: true }).click();
  await page.getByRole("menuitem", { name: "Zur Weltauswahl", exact: true }).click();
}

for (const failure of ["network", "conflict"] as const) {
  test(`A ${failure} save failure preserves the draft when leaving and allows a later retry`, async ({
    page,
  }) => {
    const world = await createTestWorld(page, "Ungesicherter Entwurf");
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/?world=${world.id}`);
    const editor = page.getByLabel("Kapiteltext");
    await expect(editor).toBeVisible();

    let rejectWrites = true;
    let rejectedWrites = 0;
    await page.route("**/api/manuscript*", async (route) => {
      if (route.request().method() !== "PUT" || !rejectWrites) return route.continue();
      rejectedWrites += 1;
      if (failure === "network") return route.abort("failed");
      const expected = Number(route.request().headers()["if-match"].replaceAll('"', ""));
      return fulfillRevisionConflict(route, expected, expected + 1);
    });

    const draft = "Dieser Entwurf muss nach einem Speicherfehler erhalten bleiben.";
    await editor.fill(draft);
    const saveError = page.getByRole("alert").filter({ hasText: "Nicht gespeichert" });
    await expect(saveError).toBeVisible();
    const firstAttemptCount = rejectedWrites;
    await returnToWorldSelection(page);
    await expect.poll(() => rejectedWrites).toBeGreaterThan(firstAttemptCount);
    await expect(saveError).toBeVisible();
    await expect(editor).toHaveText(draft);
    expect(errors).toEqual([]);

    // The simulated failure never changed the server revision. Once it is lifted,
    // the explicit exit flush must persist the same draft before closing the world.
    rejectWrites = false;
    await returnToWorldSelection(page);
    await expect(editor).toHaveCount(0);
    await page.goto(`/?world=${world.id}`);
    await expect(page.getByLabel("Kapiteltext")).toHaveText(draft);
    expect(errors).toEqual([]);
  });
}

test("A malformed figure import is rejected before it can replace the current world", async ({
  page,
}) => {
  const world = await createTestWorld(page, "Importprüfung");
  const initial = await page.request.get(`/api/state?world=${world.id}`);
  expect(initial.ok()).toBe(true);
  const revision = initial.headers().etag || '"0"';
  const saved = await page.request.put(`/api/state?world=${world.id}`, {
    headers: { "If-Match": revision },
    data: encodeStoryWorldDocument(
      { nodes: [{ id: "ada", name: "Ada", type: "person", x: 120, y: 120 }], edges: [] },
      Number(revision.replaceAll('"', "")),
    ),
  });
  expect(saved.ok()).toBe(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/?world=${world.id}`);
  await expect(page.getByLabel("Kapiteltext")).toBeVisible();
  await page.getByRole("button", { name: "Figuren", exact: true }).click();
  await expect(page.locator(".story-node")).toHaveCount(1);
  await page.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: "invalid-figures.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ nodes: [{ id: "broken" }], edges: [] })),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "Diese Datei enthält kein gültiges Figurenboard." }),
  ).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Figurenboard importieren" })).toHaveCount(0);
  await expect(page.locator(".story-node")).toHaveCount(1);
  await expect(page.locator(".story-node").first()).toContainText("Ada");
  expect(errors).toEqual([]);
  const persisted = await page.request.get(`/api/state?world=${world.id}`);
  expect(persisted.ok()).toBe(true);
  expect((await persisted.json()).payload.nodes).toMatchObject([{ id: "ada", name: "Ada" }]);
});
