/**
 * T-269 check 5.6 (implementer/T-269-audit-client.md): work text in browser storage after
 * signing out. S269-6 was the assistant history outliving the sign-out; it is closed here.
 * How the history is bound to the account: modules/assistant/historyStore.test.ts.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { writeAssistantHistory } from "../../modules/assistant";
import { forgetAccountOnDevice, removeAllDrafts, writeDraft } from "../workspace/draftStore";

const ADA = { sub: "ada", worldId: "world-a" };
const QUESTION = [{ question: "Wer verrät Mara im dritten Kapitel?" }] as never[];

beforeEach(() => localStorage.clear());

describe("T-269 5.6 browser storage", () => {
  it("signing out removes the user's drafts", () => {
    expect(writeDraft(ADA, "manuscript", { chapters: [] }, 1)).toBe(true);
    removeAllDrafts("ada");
    expect(Object.keys(localStorage).filter((key) => key.startsWith("quiltor.draft.v1"))).toEqual(
      [],
    );
  });

  it("signing out also removes the assistant history of the user's worlds", () => {
    writeDraft(ADA, "manuscript", { chapters: [] }, 1);
    writeAssistantHistory("ada", "world-a", QUESTION);
    writeAssistantHistory("ada", "world-b", QUESTION);
    forgetAccountOnDevice("ada");
    expect(localStorage.length).toBe(0);
  });
});
