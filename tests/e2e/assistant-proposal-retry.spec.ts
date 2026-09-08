import { createTestWorld, expect, test } from "./support/world-fixture";

test("A skipped assistant relationship remains retryable after its elements are accepted", async ({
  page,
}) => {
  await page.route("**/api/assistant/status*", (route) =>
    route.fulfill({ json: { ok: true, available: true, mode: "local", reason: "", chunks: 0 } }),
  );
  await page.route("**/api/assistant/jobs", (route) =>
    route.fulfill({
      json: {
        ok: true,
        created: true,
        job: {
          id: "job-proposal-retry",
          status: "completed",
          error: "",
          errorType: "",
          cancelRequested: false,
          createdAt: "2026-09-08T12:00:00Z",
          result: {
            ok: true,
            message: "Ich habe Ada, Bela und ihre Beziehung als Vorschläge vorbereitet.",
            sources: [],
            proposals: [
              {
                kind: "create_element",
                tempId: "new:ada",
                element: { type: "person", name: "Ada" },
              },
              {
                kind: "create_element",
                tempId: "new:bela",
                element: { type: "person", name: "Bela" },
              },
              {
                kind: "create_relationship",
                relationship: {
                  from: "new:ada",
                  to: "new:bela",
                  label: "Vertrauen",
                  directed: false,
                },
              },
            ],
            proposalGroups: [
              { id: "elements", proposalIndexes: [0, 1] },
              { id: "relationships", proposalIndexes: [2] },
            ],
          },
        },
      },
    }),
  );

  const world = await createTestWorld(page, "Vorschläge erneut übernehmen");
  const readStoredWorld = async () => {
    const response = await page.request.get(`/api/state?world=${world.id}`);
    expect(response.ok(), "The real world state can be read from the application server").toBe(
      true,
    );
    const document = (await response.json()) as {
      payload: {
        nodes: Array<{ id: string; name: string }>;
        edges: Array<{ from: string; to: string; label: string }>;
      };
    };
    return document.payload;
  };

  await page.goto(`/?world=${world.id}`);
  await expect(page.getByRole("toolbar", { name: "Manuskript" })).toBeVisible();
  await page.getByRole("button", { name: "Lokalen Assistenten öffnen" }).click();
  const drawer =
    (page.viewportSize()?.width || 0) < 720
      ? page.getByRole("dialog", { name: "Lokaler Assistent" })
      : page.getByRole("complementary", { name: "Lokaler Assistent" });
  await drawer
    .getByRole("textbox", { name: "Nachricht an den lokalen Assistenten" })
    .fill("Lege Ada und Bela mit ihrer Beziehung an.");
  await drawer.getByRole("button", { name: "Nachricht senden" }).click();

  const relationships = drawer.locator(".assistant-proposal-group").filter({
    has: page.getByText("Beziehungen", { exact: true }),
  });
  const elements = drawer.locator(".assistant-proposal-group").filter({
    has: page.getByText("Elemente", { exact: true }),
  });
  const missingElements =
    "Übernimm zuerst die benötigten Elemente. Danach kannst du diesen Vorschlag erneut übernehmen.";

  await relationships.getByRole("button", { name: "Gruppe übernehmen", exact: true }).click();
  await expect(relationships.getByRole("status")).toHaveText(missingElements);
  await expect(
    relationships.getByRole("button", { name: "Übernehmen", exact: true }),
  ).toBeEnabled();
  await expect(relationships.getByRole("button", { name: "Übernommen", exact: true })).toHaveCount(
    0,
  );
  expect(await readStoredWorld()).toMatchObject({ nodes: [], edges: [] });

  await elements.getByRole("button", { name: "Gruppe übernehmen", exact: true }).click();
  await expect(elements.getByRole("button", { name: "Übernommen", exact: true })).toHaveCount(2);
  await expect(page.locator(".story-node")).toHaveCount(2);
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await expect
    .poll(async () => {
      const stored = await readStoredWorld();
      return { names: stored.nodes.map((node) => node.name).sort(), edges: stored.edges.length };
    })
    .toEqual({ names: ["Ada", "Bela"], edges: 0 });

  await relationships.getByRole("button", { name: "Übernehmen", exact: true }).click();
  await expect(
    relationships.getByRole("button", { name: "Übernommen", exact: true }),
  ).toBeDisabled();
  await expect(relationships.getByRole("status")).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "Übernommen", exact: true })).toHaveCount(3);
  await expect(page.locator(".story-node")).toHaveCount(2);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect
    .poll(async () => {
      const stored = await readStoredWorld();
      const names = new Map(stored.nodes.map((node) => [node.id, node.name]));
      return {
        nodes: stored.nodes.length,
        edges: stored.edges.map((edge) => ({
          from: names.get(edge.from),
          to: names.get(edge.to),
          label: edge.label,
        })),
      };
    })
    .toEqual({ nodes: 2, edges: [{ from: "Ada", to: "Bela", label: "Vertrauen" }] });
});
