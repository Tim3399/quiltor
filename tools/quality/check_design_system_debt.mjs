import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  closeDesignSystemDebtParser,
  compareDesignSystemDebt,
  designSystemDebtBaselineUpdateCommand,
  formatDesignSystemDebtReport,
  parseDesignSystemDebtManifest,
  scanDesignSystemDebt,
  serializeDesignSystemDebtManifest,
  summarizeDesignSystemDebt,
} from "./design_system_debt.mjs";

const repositoryRoot = process.cwd();
const baselinePath = join(repositoryRoot, "tools", "quality", "design-system-debt-baseline.json");
const args = process.argv.slice(2);
const writeBaseline = args.length === 1 && args[0] === "--write-baseline";

if (args.length && !writeBaseline) {
  console.error(`Usage: node tools/quality/check_design_system_debt.mjs [--write-baseline]`);
  process.exitCode = 2;
} else {
  try {
    const current = scanDesignSystemDebt(repositoryRoot);
    if (!existsSync(baselinePath)) {
      if (!writeBaseline) {
        throw new Error(
          `Design-system debt baseline is missing. Create it with: ${designSystemDebtBaselineUpdateCommand}`,
        );
      }
      writeFileSync(baselinePath, serializeDesignSystemDebtManifest(current), "utf8");
      console.log(`Created ${baselinePath}.`);
    } else {
      const baseline = parseDesignSystemDebtManifest(readFileSync(baselinePath, "utf8"));
      const result = compareDesignSystemDebt({ baseline, current });
      if (writeBaseline) {
        if (result.increases.length) {
          console.error(formatDesignSystemDebtReport(result));
          console.error("Baseline was not written because debt may never be ratcheted upward.");
          process.exitCode = 1;
        } else if (result.reductions.length) {
          writeFileSync(baselinePath, serializeDesignSystemDebtManifest(current), "utf8");
          console.log(`Updated ${baselinePath} to the lower design-debt ceiling.`);
        } else {
          console.log("Design-system debt baseline is already current.");
        }
      } else if (!result.ok) {
        console.error(formatDesignSystemDebtReport(result));
        process.exitCode = 1;
      } else {
        const totals = summarizeDesignSystemDebt(current);
        console.log(
          `Design-system debt baseline holds: ${totals.controls} raw controls and ${totals.legacyClasses} legacy class uses in ${totals.files} files.`,
        );
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    closeDesignSystemDebtParser();
  }
}
