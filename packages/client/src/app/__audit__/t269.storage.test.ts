/**
 * T-269 phase 2, package C, check 5.6 (implementer/T-269-audit-client.md): work text in
 * browser storage after signing out.
 *
 * Audit only. The `it.fails` records gap S269-6 and turns red once the gap is closed, so the
 * phase-4 fix drops the marker in the same change.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { quiltorClient } from "../../platform";
import { removeAllDrafts, writeDraft } from "../workspace/draftStore";

const ADA = { sub: "ada", worldId: "world-a" };

beforeEach(() => localStorage.clear());

describe("T-269 5.6 browser storage", () => {
  it("signing out removes the user's drafts", () => {
    expect(writeDraft(ADA, "manuscript", { chapters: [] }, 1)).toBe(true);
    removeAllDrafts("ada");
    expect(Object.keys(localStorage).filter((key) => key.startsWith("quiltor.draft.v1"))).toEqual(
      [],
    );
  });

  // S269-6: the assistant history is keyed by world only and outlives the sign-out.
  it.fails("signing out also removes the assistant history of the user's worlds", () => {
    writeDraft(ADA, "manuscript", { chapters: [] }, 1);
    quiltorClient.platform.preferences.set(
      "quiltor-assistant:world-a",
      JSON.stringify([{ question: "Wer verrät Mara im dritten Kapitel?" }]),
    );
    removeAllDrafts("ada");
    expect(quiltorClient.platform.preferences.get("quiltor-assistant:world-a")).toBeNull();
  });
});
