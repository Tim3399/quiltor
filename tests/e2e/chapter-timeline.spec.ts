import { seedExampleWorldWithHistory } from "./support/example-world";
import { openToolbarOverflow } from "./support/toolbar-overflow";
import { expect, test } from "./support/world-fixture";

// T-86: the timeline lists the versions that changed one chapter. The seeded history keeps four
// versions; the third one only changes another chapter, so the chronicle shows three.
test("The chapter timeline shows the versions that changed the chapter and their diff", async ({
  page,
}, testInfo) => {
  const world = await seedExampleWorldWithHistory(page);
  const title = world.text("ch.x-chronicle.title");
  // On the compact viewport the binder is a sheet behind its toolbar button.
  const compact = testInfo.project.name === "compact";
  if (compact) await page.getByRole("button", { name: "Kapitel", exact: true }).click();
  const binder = compact
    ? page.getByRole("dialog", { name: "Kapitel" })
    : page.getByRole("complementary", { name: "Kapitel" });
  await binder
    .getByRole("button", { name: new RegExp(title) })
    .first()
    .click();
  await openToolbarOverflow(page, "Manuskript", "Versionen");

  await page.getByRole("radio", { name: "Timeline" }).click();
  const timeline = page.getByRole("region", {
    name: "Versionen, die dieses Kapitel geändert haben",
  });
  const rows = timeline.getByRole("button");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAccessibleName(
    new RegExp(`${world.text("ch.x-chronicle.note-4")}.*Kapitel geändert`),
  );
  await expect(rows.nth(1)).toHaveAccessibleName(
    new RegExp(`${world.text("ch.x-chronicle.note-2")}.*Kapitel geändert`),
  );
  await expect(rows.nth(2)).toHaveAccessibleName(
    new RegExp(`${world.text("ch.x-chronicle.note-1")}.*Kapitel angelegt`),
  );
  await expect(page.getByText("1 Version ohne Änderung an diesem Kapitel")).toBeVisible();

  // Choosing a version shows its pair diff in the editor, as the single-version view does.
  await rows.nth(1).click();
  await expect(rows.nth(1)).toHaveAttribute("aria-expanded", "true");
  const editor = page.getByLabel("Kapiteltext");
  await expect(editor).toHaveText(world.text("ch.x-chronicle.body-2"));
  await expect(editor.locator(".version-diff-added").first()).toBeVisible();
  await expect(timeline.getByText(/^\+\d+ \/ −\d+ Wörter$/)).toBeVisible();
});
