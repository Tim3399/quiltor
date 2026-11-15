import type { useI18n } from "../../i18n";
import { ApplicationGatewayError } from "../../platform";

type Translate = ReturnType<typeof useI18n>["t"];

/** The two places the writing aid reports a failure; a code like
 * `not_installed` means different things in each. */
export type WritingErrorContext = "lookup" | "grammar";

function errorCode(error: unknown): string {
  return error instanceof ApplicationGatewayError ? error.code : "";
}

function requiredJava(error: unknown, fallback: number): number {
  const value = error instanceof ApplicationGatewayError ? error.params.required : undefined;
  return typeof value === "number" ? value : fallback;
}

function numberParam(error: unknown, name: string): number {
  const value = error instanceof ApplicationGatewayError ? error.params[name] : undefined;
  return typeof value === "number" ? value : 0;
}

/** True for the server's request to pause, which the grammar check rides out silently. */
export function isRateLimited(error: unknown): boolean {
  return errorCode(error) === "writing_assistance.rate_limited";
}

/** The pause a `429` asked for, from its `Retry-After` header; one second when it named none. */
export function retryAfterMs(error: unknown): number {
  return Math.max(1, numberParam(error, "retryAfter")) * 1000;
}

/** "620 MB" in the interface language, which the I18nProvider keeps on <html lang>. */
function formatMegabytes(bytes: number): string {
  const locale = document.documentElement.lang || "de";
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.ceil(bytes / 1_000_000))} MB`;
}

/**
 * The text the author sees for a failed writing-assistance request.
 *
 * Every server code the writing aid can produce has its own sentence; anything
 * else -- a dropped connection, a code added later -- gets the generic one for
 * its context instead of nothing.
 */
export function writingAssistanceErrorMessage(
  error: unknown,
  context: WritingErrorContext,
  t: Translate,
  javaRequired = 17,
): string {
  switch (errorCode(error)) {
    case "writing_assistance.not_installed":
      return context === "lookup" ? t("writingDataMissing") : t("grammarUnavailable");
    case "writing_assistance.java_missing":
      return t("grammarJavaMissing").replace(
        "{version}",
        String(requiredJava(error, javaRequired)),
      );
    case "writing_assistance.download_failed":
      return t("grammarDownloadFailed");
    case "writing_assistance.checksum_mismatch":
      return t("grammarChecksumMismatch");
    case "writing_assistance.insufficient_space":
      return t("writingDataInsufficientSpace", {
        needed: formatMegabytes(numberParam(error, "needed")),
        free: formatMegabytes(numberParam(error, "free")),
      });
    case "writing_assistance.grammar_start_failed":
      return t("grammarStartFailed");
    case "writing_assistance.grammar_unavailable":
      return t("grammarServerUnavailable");
    case "writing_assistance.rate_limited":
      return t("writingRateLimited");
    case "writing_assistance.external_opt_in_required":
      return t("grammarExternalOptInRequired");
    default:
      return context === "lookup" ? t("writingRequestError") : t("grammarCheckError");
  }
}
