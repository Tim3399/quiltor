import type { Page, Route } from "@playwright/test";

/**
 * Switches device sync on or off for a page. The client reads `deviceSync` from
 * `/api/capabilities` since T-102 and only falls back to `syncAvailable` from `/api/whoami`
 * for a server without capabilities, so both answers say the same here.
 */
export async function syncAvailability(page: Page, available: boolean) {
  await page.route("**/api/whoami", async (route: Route) => {
    const response = await route.fetch();
    const body = await response.json().catch(() => ({ ok: false }));
    await route.fulfill({ response, json: { ...body, syncAvailable: available } });
  });
  await page.route("**/api/capabilities", async (route: Route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: { ...body, instance: { ...body.instance, deviceSync: available } },
    });
  });
}
