import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { README_VIEWS } from "./readme_screenshots.mjs";

/*
 *   node tools/documentation/compare_readme_screenshots.mjs <directory-a> <directory-b>
 *
 * Two capture runs of one version must agree. Byte equality is the aim, but headless
 * Chromium rasterises a few anti-aliased edge pixels differently from run to run (measured:
 * at most 95 of 1,296,000 pixels, mostly on the toolbar's lower border), so the contract is a
 * tolerance: per image at most MAX_DIFFERENT_PIXELS pixels may differ, none of them by more
 * than MAX_CHANNEL_DELTA in any channel. Anything bigger is a different picture -- other
 * text, a moved node, another theme -- and fails.
 */
export const MAX_DIFFERENT_PIXELS = 650; // 0.05 % of a 1440 x 900 picture
export const MAX_CHANNEL_DELTA = 64;

const [first, second] = process.argv.slice(2);
if (!first || !second) {
  console.error("usage: compare_readme_screenshots.mjs <directory-a> <directory-b>");
  process.exit(2);
}

const browser = await chromium.launch();
let failed = false;
try {
  const page = await browser.newPage();
  for (const view of README_VIEWS) {
    const files = [first, second].map((directory) =>
      readFileSync(resolve(directory, `${view}.png`)).toString("base64"),
    );
    if (files[0] === files[1]) {
      console.log(`${view}.png: byte-identical`);
      continue;
    }
    const result = await page.evaluate(async (encoded) => {
      const pixels = [];
      for (const data of encoded) {
        const bitmap = await createImageBitmap(
          await (await fetch(`data:image/png;base64,${data}`)).blob(),
        );
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d");
        context.drawImage(bitmap, 0, 0);
        pixels.push({
          size: [bitmap.width, bitmap.height],
          data: context.getImageData(0, 0, bitmap.width, bitmap.height).data,
        });
      }
      if (pixels[0].size.join() !== pixels[1].size.join())
        return { sizeMismatch: pixels.map((p) => p.size.join("x")) };
      let different = 0;
      let largest = 0;
      for (let i = 0; i < pixels[0].data.length; i += 4) {
        let delta = 0;
        for (let channel = 0; channel < 3; channel++)
          delta = Math.max(
            delta,
            Math.abs(pixels[0].data[i + channel] - pixels[1].data[i + channel]),
          );
        if (delta) {
          different++;
          largest = Math.max(largest, delta);
        }
      }
      return { different, largest };
    }, files);
    if (result.sizeMismatch) {
      failed = true;
      console.error(`${view}.png: sizes differ (${result.sizeMismatch.join(" vs ")})`);
    } else if (result.different > MAX_DIFFERENT_PIXELS || result.largest > MAX_CHANNEL_DELTA) {
      failed = true;
      console.error(
        `${view}.png: ${result.different} pixels differ, by up to ${result.largest} -- over tolerance`,
      );
    } else {
      console.log(
        `${view}.png: ${result.different} pixels differ, by up to ${result.largest} -- within tolerance`,
      );
    }
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
