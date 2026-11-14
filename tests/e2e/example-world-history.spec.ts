import { seedExampleWorldWithHistory } from "./support/example-world";
import { expect, test } from "./support/world-fixture";

// The helper is the seed of the chapter timeline specs (T-86). This keeps it honest on its own:
// four saved versions, newest first, each with the note the test world gives it.
test("The seeded history holds four versions with their notes", async ({ page }) => {
  const world = await seedExampleWorldWithHistory(page, { open: false });
  const response = await page.request.get(`/api/history?world=${world.id}`);
  expect(response.ok(), await response.text()).toBe(true);
  const { commits } = (await response.json()) as { commits: Array<{ subject: string }> };
  expect(commits.map((commit) => commit.subject)).toEqual(
    [4, 3, 2, 1].map((index) => world.text(`ch.x-chronicle.note-${index}`)),
  );
});
