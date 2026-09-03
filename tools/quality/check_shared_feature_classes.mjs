import {
  formatSharedFeatureClassReport,
  scanSharedFeatureClasses,
} from "./shared_feature_classes.mjs";

try {
  const violations = scanSharedFeatureClasses(process.cwd());
  console.log(formatSharedFeatureClassReport(violations));
  if (violations.length) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
