import { formatLayoutGeometryReport, scanLayoutGeometry } from "./layout_geometry.mjs";

try {
  const violations = scanLayoutGeometry(process.cwd());
  console.log(formatLayoutGeometryReport(violations));
  if (violations.length) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
