import type { Page } from "@playwright/test";
import { fulfillRevisionConflict } from "./support/application-api";
import { drawnFigures, exampleWorldDocuments, seedExampleWorld } from "./support/example-world";
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
    // A cold start is bounded by the test timeout, not by the five seconds of an assertion:
    // under a full two-worker run the first paint of the editor took longer than that once.
    await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
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
    await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
    await expect(page.getByLabel("Kapiteltext")).toHaveText(draft);
    expect(errors).toEqual([]);
  });
}

test("A malformed figure import is rejected before it can replace the current world", async ({
  page,
}) => {
  const world = await seedExampleWorld(page, { open: false });
  const figures = exampleWorldDocuments().storyWorld.nodes;
  const drawn = drawnFigures(exampleWorldDocuments().storyWorld).length;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/?world=${world.id}`);
  await expect(page.getByLabel("Kapiteltext")).toBeVisible();
  await page.getByRole("button", { name: "Figuren", exact: true }).click();
  await expect(page.locator(".story-node")).toHaveCount(drawn);
  await page.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: "invalid-figures.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ nodes: [{ id: "broken" }], edges: [] })),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "Diese Datei enthält kein gültiges Figurenboard." }),
  ).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Figurenboard importieren" })).toHaveCount(0);
  await expect(page.locator(".story-node")).toHaveCount(drawn);
  await expect(
    page.locator(".story-node").filter({ hasText: world.text("el.ada.name") }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  const persisted = await page.request.get(`/api/state?world=${world.id}`);
  expect(persisted.ok()).toBe(true);
  const persistedIds = ((await persisted.json()).payload.nodes as { id: string }[]).map(
    (node) => node.id,
  );
  expect(persistedIds).toEqual(figures.map((node) => node.id));
});
