import { describe, expect, it } from "vitest";
import type { MessageKey } from "../../i18n";
import { installPhaseLabel, installStepLabel } from "./installPhase";

const GERMAN: Partial<Record<MessageKey, string>> = {
  installingAssistant: "Wird eingerichtet … {percent}%",
  installingAssistantStep: "{phase} … {percent}%",
  installPhaseRuntime: "Laufzeit wird geladen",
  installPhaseModel: "Sprachmodell wird geladen",
  installPhaseVerifying: "Wird geprüft",
};

const t = (key: MessageKey) => GERMAN[key] ?? key;

describe("what the assistant says it is doing", () => {
  it("names the step the installer reports", () => {
    expect(installPhaseLabel("Runtime", t)).toBe("Laufzeit wird geladen");
    expect(installPhaseLabel("Model", t)).toBe("Sprachmodell wird geladen");
    expect(installPhaseLabel("Smoke test", t)).toBe("Wird geprüft");
  });

  it("shows a file being fetched under its own name", () => {
    // The runtime archive is 15 MB and the model is 2.5 GB. Seeing which one is
    // on the wire is the whole point, and its name says it better than we could.
    expect(installPhaseLabel("Qwen3-4B-Q4_K_M.gguf", t)).toBe("Qwen3-4B-Q4_K_M.gguf");
    expect(installPhaseLabel("llama-b10218-bin-ubuntu-x64.tar.gz", t)).toBe(
      "llama-b10218-bin-ubuntu-x64.tar.gz",
    );
  });

  it("says nothing when the installer has not reported a step yet", () => {
    expect(installPhaseLabel("", t)).toBe("");
    expect(installPhaseLabel("   ", t)).toBe("");
  });

  it("falls back to the plain percentage before the first step arrives", () => {
    expect(installStepLabel({ phase: "", percent: 0 }, t)).toBe("Wird eingerichtet … 0%");
  });

  it("puts the step in front of the percentage once there is one", () => {
    expect(installStepLabel({ phase: "Model", percent: 41 }, t)).toBe(
      "Sprachmodell wird geladen … 41%",
    );
    expect(installStepLabel({ phase: "model.gguf", percent: 7 }, t)).toBe("model.gguf … 7%");
  });
});
