import { afterEach, describe, expect, it, vi } from "vitest";
import { createWritingAssistanceHttpGateway } from "./writingAssistance";

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("writing-assistance HTTP port", () => {
  it("exposes status and install operations on their explicit routes", async () => {
    const grammar = {
      supported: true,
      unsupportedReason: "",
      available: true,
      installed: false,
      running: false,
      version: "6.5",
      javaVersion: 21,
      javaRequired: 17,
      externalConfigured: false,
      externalEnabled: false,
      download: { url: "https://download.example.test", checksum: "sha256", license: "LGPL" },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          ok: true,
          installed: true,
          stale: false,
          version: "2026.08",
          sources: {
            dictionary: {
              version: "1",
              url: "https://source.example.test",
              checksum: "abc",
              license: "CC-BY",
              attribution: "Example",
            },
          },
          grammar,
        }),
      )
      .mockResolvedValueOnce(response({ ok: true, version: "2026.08", entries: 42 }))
      .mockResolvedValueOnce(response({ ok: true, ...grammar, installed: true }));
    vi.stubGlobal("fetch", fetchMock);
    const writingAssistance = createWritingAssistanceHttpGateway();

    await expect(writingAssistance.status()).resolves.toMatchObject({
      ok: true,
      version: "2026.08",
      grammar,
    });
    await writingAssistance.installData();
    await writingAssistance.installGrammar();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/writing-assistance/status",
      "/api/writing-assistance/install",
      "/api/writing-assistance/grammar/install",
    ]);
    for (const index of [1, 2]) {
      expect(fetchMock.mock.calls[index]?.[1]).toEqual(
        expect.objectContaining({ method: "POST", body: "{}" }),
      );
    }
  });

  it("maps wire language to locale and forwards lookup cancellation", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        ok: true,
        query: "gehen",
        language: "en-GB",
        mode: "translation",
        version: "1",
        results: [
          {
            lemma: "go",
            partOfSpeech: "verb",
            meaning: "move",
            values: ["go", "walk"],
            source: "dictionary",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createWritingAssistanceHttpGateway().lookup(
        "en-GB",
        "translation",
        "gehen",
        controller.signal,
      ),
    ).resolves.toMatchObject({ locale: "en-GB", mode: "translation" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/writing-assistance/lookup",
      expect.objectContaining({
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({ language: "en-GB", mode: "translation", query: "gehen" }),
      }),
    );
  });

  it("sends the deterministic grammar locale and maps it back to the application model", async () => {
    const controller = new AbortController();
    const issue = {
      id: "issue-1",
      from: 0,
      to: 3,
      ruleId: "RULE",
      category: "grammar",
      message: "Prüfen",
      replacements: ["Das"],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response({ ok: true, language: "de-DE", issues: [issue] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createWritingAssistanceHttpGateway().checkGrammar(
        "Dass ist ein Test.",
        ["Quiltor"],
        controller.signal,
      ),
    ).resolves.toEqual({ ok: true, locale: "de-DE", issues: [issue] });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/writing-assistance/check",
      expect.objectContaining({
        signal: controller.signal,
        body: JSON.stringify({
          language: "de-DE",
          text: "Dass ist ein Test.",
          customWords: ["Quiltor"],
        }),
      }),
    );
  });
});
