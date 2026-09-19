import type { Locator, Page } from "@playwright/test";
import { createTestWorld, expect, test } from "./support/world-fixture";

const desktop = { width: 1440, height: 900 };
const compact = { width: 320, height: 844 };
const longSegment = "sehr-langer-untrennbarer-inhalt-".repeat(18);

async function expectNoHorizontalOverflow(locator: Locator) {
  const geometry = await locator.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
}

async function openAssistant(page: Page) {
  await page.getByRole("button", { name: "Lokalen Assistenten öffnen" }).click();
  const drawer =
    (page.viewportSize()?.width ?? 0) < 720
      ? page.getByRole("dialog", { name: "Lokaler Assistent" })
      : page.getByRole("complementary", { name: "Lokaler Assistent" });
  await expect(drawer).toBeVisible();
  return drawer;
}

async function openSnapshot(page: Page) {
  await page.getByRole("button", { name: "Mehr", exact: true }).click();
  await page.getByRole("menuitem", { name: "Arbeitsstand sichern", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Arbeitsstand sichern", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

for (const theme of ["light", "dark"] as const) {
  for (const viewport of [desktop, compact]) {
    const viewportName = viewport.width === 320 ? "320px" : "desktop";

    test(`Assistant and snapshot work output stay readable in ${theme} mode at ${viewportName}`, async ({
      page,
    }, testInfo) => {
      test.skip(
        testInfo.project.name !== "wide",
        "One project supplies the explicit viewport matrix.",
      );
      await page.setViewportSize(viewport);
      await page.route("**/api/assistant/status*", (route) =>
        route.fulfill({
          json: { ok: true, available: true, mode: "local", reason: "", chunks: 0 },
        }),
      );
      await page.route("**/api/assistant/jobs", (route) =>
        route.fulfill({
          json: {
            ok: true,
            created: true,
            job: {
              id: `job-output-${theme}-${viewport.width}`,
              status: "completed",
              error: "",
              errorType: "",
              cancelRequested: false,
              createdAt: "2026-09-12T12:00:00Z",
              result: {
                ok: true,
                message: "Ich habe den Fund als prüfbaren Vorschlag vorbereitet.",
                sources: [],
                proposals: [
                  {
                    kind: "create_element",
                    tempId: "new:long-output",
                    element: { type: "person", name: `Mara-${longSegment}` },
                  },
                ],
                proposalGroups: [{ id: "elements", proposalIndexes: [0] }],
                proposalEnvelopes: [
                  {
                    proposal: {
                      kind: "create_element",
                      tempId: "new:long-output",
                      element: { type: "person", name: `Mara-${longSegment}` },
                    },
                    evidence: [],
                    resolution: {
                      operation: "create",
                      outcome: "Im Manuskript eindeutig belegt und vor dem Übernehmen zu prüfen.",
                      status: "resolved",
                      candidateIds: [],
                    },
                  },
                ],
                agentTrace: [{ step: "collect", detail: `chapters/${longSegment}/evidence.json` }],
              },
            },
          },
        }),
      );

      const status = {
        ok: true,
        endpoint: `https://backup.example/${longSegment}`,
        changes: [`M chapters/${longSegment}.md`],
        changeCount: 1,
        suggestedMessage: "Kapitel geprüft",
      };
      await page.route("**/api/backup**", (route) => {
        const request = route.request();
        const pathname = new URL(request.url()).pathname;
        if (pathname === "/api/backup/login") {
          return route.fulfill({
            json: {
              ok: true,
              configured: true,
              hosted: false,
              endpoint: status.endpoint,
              signedIn: true,
              issuerReachable: true,
              email: "autorin@example.org",
            },
          });
        }
        if (pathname === "/api/backup" && request.method() === "POST") {
          return route.fulfill({
            json: { ok: true, log: [`saved ${longSegment}/snapshot.log`], status },
          });
        }
        return route.fulfill({ json: status });
      });

      const world = await createTestWorld(page, `Typografie ${theme} ${viewportName}`);
      await page.goto(`/?world=${world.id}`);
      await expect(page.getByRole("toolbar", { name: "Manuskript" })).toBeVisible();
      await page
        .locator("html")
        .evaluate((root, selected) => root.setAttribute("data-theme", selected), theme);

      const drawer = await openAssistant(page);
      await drawer
        .getByRole("textbox", { name: "Nachricht an den lokalen Assistenten" })
        .fill("Prüfe den Fund.");
      await drawer.getByRole("button", { name: "Nachricht senden" }).click();
      const proposal = drawer.locator(".assistant-proposal");
      await expect(proposal).toBeVisible();
      await expect(proposal).toHaveCSS("font-size", "14px");
      await expect(drawer.locator(".assistant-proposal-group > header")).toHaveCSS(
        "font-size",
        "12px",
      );
      await expect(proposal.locator("small")).toHaveCSS("font-size", "12px");
      await expectNoHorizontalOverflow(proposal);
      await page.screenshot({
        path: testInfo.outputPath(`assistant-proposal-${theme}-${viewportName}.png`),
        fullPage: true,
      });

      await proposal.getByRole("button", { name: "Bearbeiten", exact: true }).click();
      const editor = page.locator(".ui-dialog:has(.assistant-proposal-editor)");
      await expect(editor.locator(".assistant-edit-field > span").first()).toHaveCSS(
        "font-size",
        "12px",
      );
      await page.keyboard.press("Escape");

      const trace = drawer.locator(".assistant-trace");
      const traceSummary = trace.locator("summary");
      await traceSummary.click();
      await expect(traceSummary).toBeFocused();
      const traceOutput = trace.locator("pre");
      await expect(traceOutput).toHaveCSS("font-size", "12px");
      await expect(traceOutput).toHaveCSS("font-family", /monospace/);
      await traceOutput.evaluate((element) => {
        element.style.fontSize = "24px";
      });
      await expectNoHorizontalOverflow(traceOutput);
      await drawer.getByRole("button", { name: "Assistent schließen" }).click();
      await expect(drawer).toBeHidden();

      const snapshot = await openSnapshot(page);
      const technicalSummary = snapshot.locator(".utility-disclosure > summary");
      await technicalSummary.click();
      await expect(technicalSummary).toBeFocused();
      await expect(technicalSummary).toHaveCSS("font-size", "12px");
      const changedFile = snapshot.locator(".changed-files code");
      await expect(changedFile).toHaveCSS("font-size", "12px");
      await expect(changedFile).toHaveCSS("font-family", /monospace/);
      await expectNoHorizontalOverflow(snapshot.locator(".changed-files"));

      await snapshot.getByRole("button", { name: "Nur lokal sichern" }).click();
      const output = snapshot.locator(".snapshot-output");
      await expect(output).toBeVisible();
      await expect(output).toHaveCSS("font-size", "12px");
      await expect(output).toHaveCSS("font-family", /monospace/);
      await output.evaluate((element) => {
        element.style.fontSize = "24px";
      });
      await expectNoHorizontalOverflow(output);
      const dialogGeometry = await snapshot.evaluate((element) => ({
        right: element.getBoundingClientRect().right,
        viewport: window.innerWidth,
      }));
      expect(dialogGeometry.right).toBeLessThanOrEqual(dialogGeometry.viewport + 1);
      await page.screenshot({
        path: testInfo.outputPath(`snapshot-output-${theme}-${viewportName}.png`),
        fullPage: true,
      });
    });
  }
}
