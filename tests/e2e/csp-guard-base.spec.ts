import { expect, test } from "./support/transient-network";

// The specs that import transient-network directly (map chrome, pin dragging, mobile tabs,
// visual baselines, ...) carry the guard too (F-61-21). Without it this file has no
// cspViolations fixture and fails.
test("The CSP guard also watches specs without the world fixture", async ({
  page,
  cspViolations,
}) => {
  await page.route("https://example.com/**", (route) => route.fulfill({ body: "" }));
  await page.goto("/");
  await page.evaluate(() => fetch("https://example.com/").catch(() => undefined));
  await expect
    .poll(() => cspViolations.join("\n"))
    .toMatch(/^connect-src blocked https:\/\/example\.com/);
  cspViolations.length = 0;
});
