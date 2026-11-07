import { resolve } from "node:path";
import { checkReadmeScreenshots } from "../documentation/readme_screenshots.mjs";

const violations = checkReadmeScreenshots(resolve("."));
if (violations.length) {
  console.error("README screenshots do not match the repository:");
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}
console.log("README screenshots match the README and the release version.");
