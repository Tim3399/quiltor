import { checkDesignPublicApi, closeDesignPublicApiParser } from "./design_public_api.mjs";

try {
  const result = checkDesignPublicApi(process.cwd());
  if (result.violations.length) {
    console.error(
      `Design Public-API check failed (${result.violations.length}):\n${result.violations.join("\n")}`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `Design Public-API is clean: ${result.exportedFolders} exported folders across ${result.productFiles} product files.`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  closeDesignPublicApiParser();
}
