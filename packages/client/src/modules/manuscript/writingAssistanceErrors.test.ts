import { describe, expect, it } from "vitest";
import { writing as de } from "../../../../../locales/de/writing";
import { ApplicationGatewayError } from "../../platform";
import { writingAssistanceErrorMessage } from "./writingAssistanceErrors";

const t = (key: string) => (de as Record<string, string>)[key] ?? key;
const failure = (code: string, params: Record<string, unknown> = {}) =>
  new ApplicationGatewayError("server text", code, { params });

describe("writingAssistanceErrorMessage", () => {
  it.each([
    [
      "writing_assistance.java_missing",
      "grammar",
      "Für die lokale Grammatikprüfung wird Java 21 oder neuer benötigt.",
    ],
    ["writing_assistance.download_failed", "grammar", de.grammarDownloadFailed],
    ["writing_assistance.checksum_mismatch", "grammar", de.grammarChecksumMismatch],
    ["writing_assistance.grammar_start_failed", "grammar", de.grammarStartFailed],
    ["writing_assistance.grammar_unavailable", "grammar", de.grammarServerUnavailable],
    ["writing_assistance.external_opt_in_required", "grammar", de.grammarExternalOptInRequired],
    ["writing_assistance.not_installed", "grammar", de.grammarUnavailable],
    ["writing_assistance.not_installed", "lookup", de.writingDataMissing],
  ] as const)("maps %s in %s to its own sentence", (code, context, expected) => {
    expect(writingAssistanceErrorMessage(failure(code, { required: 21 }), context, t)).toBe(
      expected,
    );
  });

  it("names the needed and the free space when the drive is too small", () => {
    document.documentElement.lang = "de";
    const message = writingAssistanceErrorMessage(
      failure("writing_assistance.insufficient_space", { needed: 620_400_000, free: 1_500_000 }),
      "lookup",
      (key: string, params?: Record<string, string | number>) =>
        Object.entries(params ?? {}).reduce(
          (text, [name, value]) => text.replace(`{${name}}`, String(value)),
          (de as Record<string, string>)[key] ?? key,
        ),
    );
    expect(message).toBe(
      "Für die Sprachdaten fehlt freier Speicher: Benötigt werden 621 MB, frei sind 2 MB.",
    );
  });

  it("falls back to the generic sentence for an unknown code or a dropped connection", () => {
    expect(writingAssistanceErrorMessage(failure("application.internal_error"), "lookup", t)).toBe(
      de.writingRequestError,
    );
    expect(writingAssistanceErrorMessage(new TypeError("Failed to fetch"), "grammar", t)).toBe(
      de.grammarCheckError,
    );
  });

  it("uses the status' Java requirement when the error carries none", () => {
    expect(
      writingAssistanceErrorMessage(failure("writing_assistance.java_missing"), "grammar", t, 17),
    ).toBe("Für die lokale Grammatikprüfung wird Java 17 oder neuer benötigt.");
  });
});
