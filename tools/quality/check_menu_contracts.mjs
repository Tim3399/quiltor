import { formatMenuContractReport, scanMenuContracts } from "./menu_contracts.mjs";

try {
  const violations = scanMenuContracts(process.cwd());
  console.log(formatMenuContractReport(violations));
  if (violations.length) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
