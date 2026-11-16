import { expect, test } from "./support/world-fixture";

// The guard on every product test is only worth something if it notices a violation at all.
test("The CSP guard records a fetch outside connect-src", async ({ page, cspViolations }) => {
  // Report-only lets the request through; answer it here so nothing leaves the machine.
  await page.route("https://example.com/**", (route) => route.fulfill({ body: "" }));
  await page.goto("/");
  await page.evaluate(() => fetch("https://example.com/").catch(() => undefined));
  await expect
    .poll(() => cspViolations.join("\n"))
    .toMatch(/^connect-src blocked https:\/\/example\.com/);
  cspViolations.length = 0;
});

test("The client page loads without a CSP violation", async ({ page, cspViolations }) => {
  await page.goto("/");
  await expect(page.locator("#root")).not.toBeEmpty();
  expect(cspViolations).toEqual([]);
});
