import { beforeEach, describe, expect, it } from "vitest";
import { quiltorClient } from "../../platform";
import {
  assistantHistoryKey,
  readAssistantHistory,
  removeAllAssistantHistory,
  writeAssistantHistory,
} from "./historyStore";

const QUESTION = [{ question: "Wer verrät Mara im dritten Kapitel?" }] as never[];
const preferences = () => quiltorClient.platform.preferences;

beforeEach(() => localStorage.clear());

describe("assistant history store (T-269 S269-6)", () => {
  it("another account on the same device does not read the history", () => {
    writeAssistantHistory("ada", "world-a", QUESTION);
    expect(readAssistantHistory("ben", "world-a")).toEqual([]);
    expect(readAssistantHistory("ada", "world-a")).toEqual(QUESTION);
  });

  it("removing one account's history leaves another account's alone", () => {
    writeAssistantHistory("ada", "world-a", QUESTION);
    writeAssistantHistory("ben", "world-a", QUESTION);
    removeAllAssistantHistory("ada");
    expect(readAssistantHistory("ada", "world-a")).toEqual([]);
    expect(readAssistantHistory("ben", "world-a")).toEqual(QUESTION);
  });

  it("drops a world-only history from before the binding once an account reads", () => {
    preferences().set("quiltor-assistant:world-a", JSON.stringify(QUESTION));
    expect(readAssistantHistory("ada", "world-a")).toEqual([]);
    expect(preferences().get("quiltor-assistant:world-a")).toBeNull();
  });

  it("keeps the world-only key in local mode, where there is no account", () => {
    expect(assistantHistoryKey(undefined, "world-a")).toBe("quiltor-assistant:world-a");
    writeAssistantHistory(undefined, "world-a", QUESTION);
    expect(readAssistantHistory(undefined, "world-a")).toEqual(QUESTION);
  });

  it("keeps the last forty entries", () => {
    const entries = Array.from({ length: 45 }, (_, index) => ({ question: String(index) }));
    writeAssistantHistory("ada", "world-a", entries as never[]);
    const stored = readAssistantHistory("ada", "world-a") as unknown as { question: string }[];
    expect(stored).toHaveLength(40);
    expect(stored[0]?.question).toBe("5");
  });
});
