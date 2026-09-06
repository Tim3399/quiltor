import { formatActionRankReport, scanActionRanks } from "./action_ranks.mjs";

try {
  const violations = scanActionRanks(process.cwd());
  console.log(formatActionRankReport(violations));
  if (violations.length) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
