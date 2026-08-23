import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  compareCssDesignDebt,
  cssDesignDebtBaselineUpdateCommand,
  formatCssDesignDebtReport,
  parseCssDesignDebtManifest,
  scanCssDesignDebt,
  serializeCssDesignDebtManifest,
  summarizeCssDesignDebt,
} from "./css_design_debt.mjs";

const repositoryRoot = process.cwd();
const baselinePath = join(repositoryRoot, "tools", "quality", "css-design-debt-baseline.json");
const args = process.argv.slice(2);
const writeBaseline = args.length === 1 && args[0] === "--write-baseline";

if (args.length && !writeBaseline) {
  console.error("Usage: node tools/quality/check_css_design_debt.mjs [--write-baseline]");
  process.exitCode = 2;
} else {
  try {
    const current = scanCssDesignDebt(repositoryRoot);
    if (!existsSync(baselinePath)) {
      if (!writeBaseline) {
        throw new Error(
          `CSS design-debt baseline is missing. Create it with: ${cssDesignDebtBaselineUpdateCommand}`,
        );
      }
      writeFileSync(baselinePath, serializeCssDesignDebtManifest(current), "utf8");
      console.log(`Created ${baselinePath}.`);
    } else {
      const baseline = parseCssDesignDebtManifest(readFileSync(baselinePath, "utf8"));
      const result = compareCssDesignDebt({ baseline, current });
      if (writeBaseline) {
        if (result.increases.length) {
          console.error(formatCssDesignDebtReport(result));
          console.error("Baseline was not written because debt may never be ratcheted upward.");
          process.exitCode = 1;
        } else if (result.reductions.length) {
          writeFileSync(baselinePath, serializeCssDesignDebtManifest(current), "utf8");
          console.log(`Updated ${baselinePath} to the lower CSS design-debt ceiling.`);
        } else {
          console.log("CSS design-debt baseline is already current.");
        }
      } else if (!result.ok) {
        console.error(formatCssDesignDebtReport(result));
        process.exitCode = 1;
      } else {
        const totals = summarizeCssDesignDebt(current);
        console.log(
          `CSS design-debt baseline holds: ${totals.nativeTypeSelectors} native control selector branches and ${totals.designOwnerOverrides} design-owner overrides in ${totals.files} files.`,
        );
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
