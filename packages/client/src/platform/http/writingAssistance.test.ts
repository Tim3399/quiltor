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
  it("preserves exact POST requests, body order, locales, and signal presence", async () => {
    const controller = new AbortController();
    const cases = [
      {
        name: "install data",
        invoke: (_signal?: AbortSignal) => createWritingAssistanceHttpGateway().installData(),
        response: { ok: true, version: "2026.08", entries: 42 },
        url: "/api/writing-assistance/install",
        body: "{}",
        signal: false,
      },
      {
        name: "lookup with signal",
        invoke: (signal?: AbortSignal) =>
          createWritingAssistanceHttpGateway().lookup("en-GB", "translation", "gehen", signal),
        response: {
          ok: true,
          query: "gehen",
          language: "en-GB",
          mode: "translation",
          version: "1",
          results: [],
        },
        url: "/api/writing-assistance/lookup",
        body: '{"language":"en-GB","mode":"translation","query":"gehen"}',
        signal: true,
      },
      {
        name: "lookup with explicit undefined signal",
        invoke: (signal?: AbortSignal) =>
          createWritingAssistanceHttpGateway().lookup("de-DE", "dictionary", "gehen", signal),
        response: {
          ok: true,
          query: "gehen",
          language: "de-DE",
          mode: "dictionary",
          version: "1",
          results: [],
        },
        url: "/api/writing-assistance/lookup",
        body: '{"language":"de-DE","mode":"dictionary","query":"gehen"}',
        signal: undefined,
      },
      {
        name: "install grammar",
        invoke: (_signal?: AbortSignal) => createWritingAssistanceHttpGateway().installGrammar(),
        response: { ok: true, installed: true },
        url: "/api/writing-assistance/grammar/install",
        body: "{}",
        signal: false,
      },
      {
        name: "check grammar with signal",
        invoke: (signal?: AbortSignal) =>
          createWritingAssistanceHttpGateway().checkGrammar(
            "Dass ist ein Test.",
            ["Quiltor"],
            signal,
          ),
        response: { ok: true, language: "de-DE", issues: [] },
        url: "/api/writing-assistance/check",
        body: '{"language":"de-DE","text":"Dass ist ein Test.","customWords":["Quiltor"]}',
        signal: true,
      },
      {
        name: "check grammar with explicit undefined signal",
        invoke: (signal?: AbortSignal) =>
          createWritingAssistanceHttpGateway().checkGrammar("Ein Satz.", [], signal),
        response: { ok: true, language: "de-DE", issues: [] },
        url: "/api/writing-assistance/check",
        body: '{"language":"de-DE","text":"Ein Satz.","customWords":[]}',
        signal: undefined,
      },
    ];

    for (const requestCase of cases) {
      const fetchMock = vi.fn().mockResolvedValue(response(requestCase.response));
      vi.stubGlobal("fetch", fetchMock);
      const signal = requestCase.signal === true ? controller.signal : undefined;

      const request = requestCase.invoke(signal);

      expect(fetchMock.mock.calls, requestCase.name).toStrictEqual([
        [
          requestCase.url,
          {
            cache: "no-store",
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: requestCase.body,
            ...(requestCase.signal === false ? {} : { signal }),
          },
        ],
      ]);
      if (requestCase.signal !== false) {
        expect(fetchMock.mock.calls[0]?.[1]).toHaveProperty("signal");
        expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(signal);
      }
      await expect(request).resolves.toBeDefined();
    }
  });

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

  it("preserves structured HTTP rejections for every POST operation", async () => {
    const operations = [
      () => createWritingAssistanceHttpGateway().installData(),
      () => createWritingAssistanceHttpGateway().lookup("de-DE", "dictionary", "Wort"),
      () => createWritingAssistanceHttpGateway().installGrammar(),
      () => createWritingAssistanceHttpGateway().checkGrammar("Ein Satz.", []),
    ];

    for (const invoke of operations) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              ok: false,
              error: {
                code: "writing_assistance.unavailable",
                params: { component: "dictionary" },
                retryable: true,
              },
            }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          ),
        ),
      );

      await expect(invoke()).rejects.toMatchObject({
        code: "writing_assistance.unavailable",
        category: "unavailable",
        params: { component: "dictionary" },
        retryable: true,
      });
    }
  });

  it("preserves native fetch rejection identity for every POST operation", async () => {
    const operations = [
      () => createWritingAssistanceHttpGateway().installData(),
      () => createWritingAssistanceHttpGateway().lookup("de-DE", "dictionary", "Wort"),
      () => createWritingAssistanceHttpGateway().installGrammar(),
      () => createWritingAssistanceHttpGateway().checkGrammar("Ein Satz.", []),
    ];

    for (const error of [
      new TypeError("fetch failed"),
      new DOMException("cancelled", "AbortError"),
    ]) {
      for (const invoke of operations) {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
        await expect(invoke()).rejects.toBe(error);
      }
    }
  });

  it("keeps undecoded install results and current malformed decoder failures", async () => {
    const passthrough = { ok: "not validated", extra: { retained: true } };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(passthrough))
      .mockResolvedValueOnce(response(passthrough))
      .mockResolvedValueOnce(new Response("not JSON", { status: 200 }))
      .mockResolvedValueOnce(new Response("not JSON", { status: 200 }))
      .mockResolvedValueOnce(response({ ok: true, language: "de-DE" }))
      .mockResolvedValueOnce(response({ ok: true, language: "de-DE" }));
    vi.stubGlobal("fetch", fetchMock);
    const gateway = createWritingAssistanceHttpGateway();

    await expect(gateway.installData()).resolves.toStrictEqual(passthrough);
    await expect(gateway.installGrammar()).resolves.toStrictEqual(passthrough);
    await expect(gateway.installData()).resolves.toBeNull();
    await expect(gateway.installGrammar()).resolves.toBeNull();
    await expect(gateway.lookup("de-DE", "dictionary", "Wort")).rejects.toBeInstanceOf(TypeError);
    await expect(gateway.checkGrammar("Ein Satz.", [])).rejects.toBeInstanceOf(TypeError);
  });
});
