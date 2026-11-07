import { expect, type Page, request, test } from "@playwright/test";

// T-58 P7b, D-102: Keycloak ends the session while the author types. The text must survive --
// on the page until the author signs in again, and on the device across a reload.

const ISSUER = `http://127.0.0.1:${Number(process.env.QUILTOR_OIDC_E2E_ISSUER_PORT || 8036)}`;
// oidc_stack.py gives access tokens two seconds; past that a request has to refresh.
const ACCESS_TOKEN_EXPIRED_MS = 3_000;
const SESSION_ENDED =
  "Deine Anmeldung ist abgelaufen. Melde dich in einem neuen Tab an, dein Text bleibt hier erhalten.";

async function signIn(page: Page) {
  // The fake issuer grants at once: /login -> /authorize -> /auth/callback -> the app.
  await page.goto("/login");
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/"));
}

async function openNewWorld(page: Page, title: string): Promise<string> {
  const created = await page.request.post("/api/worlds/create", {
    data: { title, backupUrl: "" },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const { world } = (await created.json()) as { world: { id: string } };
  await page.goto(`/?world=${world.id}`);
  await expect(page.getByRole("toolbar", { name: "Manuskript" })).toBeVisible();
  return world.id;
}

/** Ends every session at the issuer and waits until Quiltor has to ask it again. */
async function endSessionAtTheIssuer(page: Page) {
  const issuer = await request.newContext();
  const ended = await issuer.post(`${ISSUER}/test/end-sessions`);
  expect(ended.status()).toBe(204);
  await issuer.dispose();
  await page.waitForTimeout(ACCESS_TOKEN_EXPIRED_MS);
}

async function type(page: Page, text: string) {
  const editor = page.getByLabel("Kapiteltext");
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(text);
}

async function storedManuscript(page: Page, worldId: string): Promise<string> {
  const response = await page.request.get(`/api/manuscript?world=${worldId}`);
  expect(response.ok(), await response.text()).toBe(true);
  return response.text();
}

test.beforeEach(async ({ page }) => {
  // Leaving a page with unsaved text asks first; the tests leave on purpose.
  page.on("dialog", (dialog) => void dialog.accept());
  await signIn(page);
});

test("text typed after the session ended is saved once the author signs in again in a new tab", async ({
  page,
  context,
}) => {
  const worldId = await openNewWorld(page, "Abgelaufene Sitzung");
  await endSessionAtTheIssuer(page);

  await type(page, "Der Morgen lag still über dem Hafen.");

  await expect(page.getByText(SESSION_ENDED)).toBeVisible({ timeout: 15_000 });
  // The workspace stays: the text is still on the page.
  await expect(page.getByLabel("Kapiteltext")).toContainText(
    "Der Morgen lag still über dem Hafen.",
  );

  const [loginTab] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("button", { name: "In neuem Tab anmelden" }).click(),
  ]);
  await loginTab.waitForLoadState();
  await loginTab.waitForURL(
    (url) => !url.pathname.startsWith("/auth/") && url.pathname !== "/login",
  );
  await loginTab.close();

  await page.getByRole("button", { name: "Erneut versuchen" }).click();

  await expect(page.getByText(SESSION_ENDED)).toBeHidden({ timeout: 15_000 });
  await expect
    .poll(() => storedManuscript(page, worldId), { timeout: 15_000 })
    .toContain("Der Morgen lag still über dem Hafen.");
});

test("a reload before signing in again offers the kept draft, and adopting it saves the text", async ({
  page,
}) => {
  const worldId = await openNewWorld(page, "Entwurf nach Reload");
  await endSessionAtTheIssuer(page);

  await type(page, "Die Möwen schrien über der Mole.");
  await expect(page.getByText(SESSION_ENDED)).toBeVisible({ timeout: 15_000 });

  // The tab is reloaded before the author signs in again: the page's own memory is gone.
  await page.reload();
  await signIn(page);
  await page.goto(`/?world=${worldId}`);

  await expect(
    page.getByRole("heading", { name: "Ungespeicherter Entwurf gefunden: Manuskript" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Entwurf übernehmen" }).click();

  await expect(page.getByLabel("Kapiteltext")).toContainText("Die Möwen schrien über der Mole.");
  await expect
    .poll(() => storedManuscript(page, worldId), { timeout: 15_000 })
    .toContain("Die Möwen schrien über der Mole.");
});
