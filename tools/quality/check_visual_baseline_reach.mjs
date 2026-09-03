import { checkVisualBaselineReach, formatVisualBaselineReport } from "./visual_baseline_reach.mjs";

try {
  const violations = checkVisualBaselineReach(process.cwd());
  console.log(formatVisualBaselineReport(violations));
  if (violations.length) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
