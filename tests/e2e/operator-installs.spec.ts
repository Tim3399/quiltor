import { encodeManuscriptV1 } from "../../packages/client/src/platform/contracts/v1/manuscript";
import { createTestWorld, expect, test } from "./support/world-fixture";

// On a hosted server the operator installs LanguageTool and the language data
// (D-59). The client reads `installable` from the status and offers no install
// button; the status is mocked so the suite does not need a hosted server.
test("A server that is not installable offers no grammar install, only the operator note", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "The writing aid sits beside the text when wide.");
  const world = await createTestWorld(page, `Betreiber ${crypto.randomUUID()}`);
  const seeded = await page.request.put(`/api/manuscript?world=${world.id}`, {
    headers: { "If-Match": '"0"' },
    data: encodeManuscriptV1(
      { chapters: [{ id: "opening", title: "Anfang", body: "Hallo Welt", note: "" }] },
      0,
    ),
  });
  expect(seeded.ok(), await seeded.text()).toBeTruthy();
  await page.route("**/api/writing-assistance/status", (route) =>
    route.fulfill({
      json: {
        ok: true,
        installed: true,
        installable: false,
        stale: false,
        version: "test",
        sources: {},
        grammar: {
          supported: true,
          unsupportedReason: "",
          available: false,
          installed: false,
          running: false,
          installable: false,
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
  const installs: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/install")) installs.push(request.url());
  });

  await page.goto(`/?world=${world.id}`);
  await page.getByRole("radio", { name: "Schreibhilfe", exact: true }).click();
  await page.getByRole("tab", { name: "Prüfen", exact: true }).click();

  await expect(page.getByText("Wird vom Betreiber eingerichtet")).toBeVisible();
  await expect(page.getByRole("button", { name: "LanguageTool lokal installieren" })).toHaveCount(
    0,
  );
  expect(installs).toEqual([]);
});
