import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import manuscriptFixture from "../../../../../contracts/fixtures/application-api/manuscript/wire.v1.json";
import manuscriptExportFixture from "../../../../../contracts/fixtures/application-api/manuscript-export/preview.v1.json";
import storyboardsFixture from "../../../../../contracts/fixtures/application-api/storyboards/wire.v1.json";
import revisionConflict from "../../../../../contracts/fixtures/application-api/structured-error/revision-conflict.v1.json";
import type {
  ApplicationGateway,
  ManuscriptDocxPreview,
  ManuscriptEpubPreview,
} from "../application";
import { createPlatformGateway } from "../createPlatformGateway";
import { createHttpApplicationGateway } from ".";

const WORLD_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const docxPreview: ManuscriptDocxPreview = {
  preset: "editor",
  revision: 7,
  sourceSha256: "a".repeat(64),
  fileName: "Quiltor-Manuskript.docx",
  chapters: [{ id: "chapter-1", title: "Ankunft", words: 3, excerpt: "Mara wartet am Hafen." }],
  counts: {
    manuscriptChapters: 2,
    manuscriptWords: 5,
    exportedChapters: 1,
    exportedWords: 3,
  },
  warnings: [{ code: "excluded_chapters", count: 1 }],
};
const epubPreview: ManuscriptEpubPreview = {
  ...docxPreview,
  preset: "epub",
  fileName: "Quiltor-Manuskript.epub",
  metadata: { title: "Hafenlicht", author: "Mara Beispiel", language: "de-DE" },
};
let application: ApplicationGateway;

function response(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function envelopeWithoutRevision(): Record<string, unknown> {
  const envelope = JSON.parse(JSON.stringify(manuscriptFixture)) as Record<string, unknown>;
  delete envelope.revision;
  return envelope;
}

function manuscriptAtRevision(revision: number): Record<string, unknown> {
  return { ...JSON.parse(JSON.stringify(manuscriptFixture)), revision } as Record<string, unknown>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  application = createHttpApplicationGateway(createPlatformGateway());
  application.worlds.select(WORLD_ID);
});

afterEach(() => vi.unstubAllGlobals());

describe("document HTTP v1 boundary", () => {
  it("previews, renders, and saves a reviewed manuscript EPUB", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: true, preview: epubPreview }))
      .mockResolvedValueOnce(
        new Response("epub-data", {
          status: 200,
          headers: { "Content-Type": "application/epub+zip" },
        }),
      );
    const save = vi.fn().mockResolvedValue({ status: "saved" });
    application = createHttpApplicationGateway(createPlatformGateway({ files: { save } }));
    application.worlds.select(WORLD_ID);
    vi.stubGlobal("fetch", fetchMock);

    const reviewed = await application.documents.previewManuscriptExport("epub");
    const blob = await application.documents.renderManuscriptExport(reviewed.preview, [
      "excluded_chapters",
    ]);
    await expect(
      application.documents.saveManuscriptExport(blob, reviewed.preview.fileName),
    ).resolves.toBe("saved");

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ preset: "epub" });
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/manuscript-export/epub?world=${WORLD_ID}`);
    expect(fetchMock.mock.calls[1][1].headers).toEqual({
      "Content-Type": "application/json",
      Accept: "application/epub+zip",
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      preset: "epub",
      revision: 7,
      sourceSha256: "a".repeat(64),
      acknowledgedWarnings: ["excluded_chapters"],
    });
    expect(await blob.text()).toBe("epub-data");
    expect(save).toHaveBeenCalledWith("Quiltor-Manuskript.epub", blob);
  });

  it.each([
    ["wrong preset", { preset: "editor" }],
    ["wrong filename", { fileName: "unsafe.epub" }],
    ["missing metadata", { metadata: undefined }],
    ["blank title", { metadata: { ...epubPreview.metadata, title: " " } }],
    ["overlong author", { metadata: { ...epubPreview.metadata, author: "Ä".repeat(1001) } }],
    ["invalid language", { metadata: { ...epubPreview.metadata, language: "de_Deutsch" } }],
  ])("rejects an EPUB preview with %s", async (_name, change) => {
    const changed = { ...epubPreview, ...change } as Record<string, unknown>;
    if ("metadata" in change && change.metadata === undefined) delete changed.metadata;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ok: true, preview: changed })));

    await expect(application.documents.previewManuscriptExport("epub")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("rejects an EPUB download with the wrong MIME type", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("data", { headers: { "Content-Type": "text/plain" } })),
    );

    await expect(
      application.documents.renderManuscriptExport(epubPreview, ["excluded_chapters"]),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("previews, renders, and saves a reviewed manuscript DOCX", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: true, preview: docxPreview }))
      .mockResolvedValueOnce(
        new Response("docx-data", {
          status: 200,
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          },
        }),
      );
    const save = vi.fn().mockResolvedValue({ status: "saved" });
    application = createHttpApplicationGateway(createPlatformGateway({ files: { save } }));
    application.worlds.select(WORLD_ID);
    vi.stubGlobal("fetch", fetchMock);

    const reviewed = await application.documents.previewManuscriptDocx("editor");
    const blob = await application.documents.renderManuscriptDocx(reviewed.preview, [
      "excluded_chapters",
    ]);
    await expect(
      application.documents.saveManuscriptDocx(blob, reviewed.preview.fileName),
    ).resolves.toBe("saved");

    expect(fetchMock.mock.calls[0][0]).toBe(`/api/manuscript-export/preview?world=${WORLD_ID}`);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ preset: "editor" });
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/manuscript-export/docx?world=${WORLD_ID}`);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      preset: "editor",
      revision: 7,
      sourceSha256: "a".repeat(64),
      acknowledgedWarnings: ["excluded_chapters"],
    });
    expect(await blob.text()).toBe("docx-data");
    expect(save).toHaveBeenCalledWith("Quiltor-Manuskript.docx", blob);
  });

  it("accepts the registered preview fixture and preserves an empty chapter title", async () => {
    const fixture = structuredClone(manuscriptExportFixture);
    fixture.preview.chapters[0].title = "";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(fixture)));

    await expect(application.documents.previewManuscriptDocx("editor")).resolves.toMatchObject({
      preview: { chapters: [{ title: "" }] },
    });
  });

  it("keeps a cancelled native file picker neutral", async () => {
    const save = vi.fn().mockResolvedValue({ status: "cancelled" });
    application = createHttpApplicationGateway(createPlatformGateway({ files: { save } }));

    await expect(
      application.documents.saveManuscriptDocx(new Blob(["docx"]), "Quiltor-Manuskript.docx"),
    ).resolves.toBe("cancelled");
  });

  it.each([
    ["wrong exported chapter count", { counts: { ...docxPreview.counts, exportedChapters: 2 } }],
    ["wrong exported word count", { counts: { ...docxPreview.counts, exportedWords: 4 } }],
    ["unknown warning", { warnings: [{ code: "layout", count: 1 }] }],
    ["wrong filename", { fileName: "unsafe.docx" }],
  ])("rejects a malformed DOCX preview with %s", async (_name, change) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ ok: true, preview: { ...docxPreview, ...change } })),
    );

    await expect(application.documents.previewManuscriptDocx("editor")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it.each([
    ["an extra envelope property", { ...manuscriptExportFixture, extra: true }],
    [
      "an extra preview property",
      {
        ...manuscriptExportFixture,
        preview: { ...manuscriptExportFixture.preview, extra: true },
      },
    ],
    [
      "EPUB metadata on a DOCX preview",
      {
        ...manuscriptExportFixture,
        preview: {
          ...manuscriptExportFixture.preview,
          metadata: { title: "Manuskript", author: "", language: "de" },
        },
      },
    ],
    [
      "an extra chapter property",
      {
        ...manuscriptExportFixture,
        preview: {
          ...manuscriptExportFixture.preview,
          chapters: [{ ...manuscriptExportFixture.preview.chapters[0], extra: true }],
        },
      },
    ],
    [
      "an overlong Unicode chapter id",
      {
        ...manuscriptExportFixture,
        preview: {
          ...manuscriptExportFixture.preview,
          chapters: [{ ...manuscriptExportFixture.preview.chapters[0], id: "🧵".repeat(201) }],
        },
      },
    ],
    [
      "an overlong Unicode title",
      {
        ...manuscriptExportFixture,
        preview: {
          ...manuscriptExportFixture.preview,
          chapters: [{ ...manuscriptExportFixture.preview.chapters[0], title: "Ä".repeat(1001) }],
        },
      },
    ],
    [
      "an overlong Unicode excerpt",
      {
        ...manuscriptExportFixture,
        preview: {
          ...manuscriptExportFixture.preview,
          chapters: [{ ...manuscriptExportFixture.preview.chapters[0], excerpt: "🌊".repeat(281) }],
        },
      },
    ],
    [
      "an extra counts property",
      {
        ...manuscriptExportFixture,
        preview: {
          ...manuscriptExportFixture.preview,
          counts: { ...manuscriptExportFixture.preview.counts, extra: 0 },
        },
      },
    ],
    [
      "an extra warning property",
      {
        ...manuscriptExportFixture,
        preview: {
          ...manuscriptExportFixture.preview,
          warnings: [{ ...manuscriptExportFixture.preview.warnings[0], extra: true }],
        },
      },
    ],
  ])("rejects a strict-contract preview with %s", async (_name, body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body)));

    await expect(application.documents.previewManuscriptDocx("editor")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("rejects an unsafe aggregate chapter word count", async () => {
    const chapters = [
      { id: "one", title: "", words: Number.MAX_SAFE_INTEGER, excerpt: "" },
      { id: "two", title: "", words: 1, excerpt: "" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          ok: true,
          preview: {
            ...docxPreview,
            chapters,
            counts: {
              manuscriptChapters: 2,
              manuscriptWords: Number.MAX_SAFE_INTEGER,
              exportedChapters: 2,
              exportedWords: Number.MAX_SAFE_INTEGER,
            },
          },
        }),
      ),
    );

    await expect(application.documents.previewManuscriptDocx("editor")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("rejects more than 10,000 exported chapters", async () => {
    const chapters = Array.from({ length: 10_001 }, (_, index) => ({
      id: `chapter-${index}`,
      title: "",
      words: 0,
      excerpt: "",
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          ok: true,
          preview: {
            ...docxPreview,
            chapters,
            counts: {
              manuscriptChapters: chapters.length,
              manuscriptWords: 0,
              exportedChapters: chapters.length,
              exportedWords: 0,
            },
            warnings: [],
          },
        }),
      ),
    );

    await expect(application.documents.previewManuscriptDocx("editor")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it.each([
    ["wrong MIME", new Response("data", { headers: { "Content-Type": "text/plain" } })],
    [
      "empty body",
      new Response("", {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      }),
    ],
  ])("rejects a DOCX download with %s", async (_name, rendered) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(rendered));
    await expect(
      application.documents.renderManuscriptDocx(docxPreview, ["excluded_chapters"]),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("renders and saves a book PDF as separate operations", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("pdf-data", { status: 200, headers: { "Content-Type": "application/pdf" } }),
      );
    const save = vi.fn().mockResolvedValue({ status: "saved" });
    application = createHttpApplicationGateway(createPlatformGateway({ files: { save } }));
    application.worlds.select(WORLD_ID);
    vi.stubGlobal("fetch", fetchMock);

    const rendered = await application.documents.renderBookPdf();
    expect(await rendered.text()).toBe("pdf-data");
    expect(save).not.toHaveBeenCalled();

    await application.documents.saveBookPdf(rendered);
    expect(save).toHaveBeenCalledWith(
      expect.stringMatching(/^Quiltor-Buchfassung-.*\.pdf$/),
      rendered,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps render and save failures attributable to their operation", async () => {
    const save = vi.fn().mockResolvedValue({ status: "failed", error: "disk full" });
    application = createHttpApplicationGateway(createPlatformGateway({ files: { save } }));
    application.worlds.select(WORLD_ID);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: false, error: { code: "pdf.unavailable" } }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response("pdf", {
            status: 200,
            headers: { "Content-Type": "application/pdf" },
          }),
        ),
    );

    await expect(application.documents.renderBookPdf()).rejects.toMatchObject({
      code: "pdf.unavailable",
    });
    const rendered = await application.documents.renderBookPdf();
    await expect(application.documents.saveBookPdf(rendered)).rejects.toThrow("disk full");
  });

  it("keeps bookPdf as a render-then-save compatibility wrapper", async () => {
    const save = vi.fn().mockResolvedValue({ status: "saved" });
    application = createHttpApplicationGateway(createPlatformGateway({ files: { save } }));
    application.worlds.select(WORLD_ID);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("pdf", {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        }),
      ),
    );

    await application.documents.bookPdf();

    expect(save).toHaveBeenCalledOnce();
  });

  it("loads the envelope, verifies its revision and exposes only the domain document", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(manuscriptFixture, { ETag: '"7"' }));
    vi.stubGlobal("fetch", fetchMock);

    const manuscript = await application.manuscript.load();

    expect(manuscript.chapters[0].title).toBe("Die Ankunft");
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/manuscript?world=${WORLD_ID}`,
      expect.objectContaining({
        headers: { Accept: "application/vnd.quiltor.document.v1+json" },
      }),
    );
  });

  it("saves the same v1 envelope and keeps world routing out of the payload", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(manuscriptFixture, { ETag: '"7"' }))
      .mockResolvedValueOnce(
        response({
          ok: true,
          zeit: "12:00:00",
          revision: 8,
          warnings: ["backup.mirror_failed"],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const manuscript = await application.manuscript.load();

    const result = await application.manuscript.save(manuscript);
    expect(result.warnings).toEqual(["backup.mirror_failed"]);

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(url).toBe(`/api/manuscript?world=${WORLD_ID}`);
    expect(init.headers).toEqual(
      expect.objectContaining({
        "Content-Type": "application/json",
        "If-Match": '"7"',
      }),
    );
    expect(body).toEqual(manuscriptFixture);
    expect(body.payload).not.toHaveProperty("worldId");
  });

  it("loads and saves Storyboards through their own revision channel", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(storyboardsFixture, { ETag: '"3"' }))
      .mockResolvedValueOnce(response(manuscriptFixture, { ETag: '"7"' }))
      .mockResolvedValueOnce(response({ ok: true, zeit: "12:00:00", revision: 4 }));
    vi.stubGlobal("fetch", fetchMock);

    const storyboards = await application.storyboards.load();
    await application.manuscript.load();
    await application.storyboards.save(storyboards);

    const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(storyboards.boards[0]).toMatchObject({
      id: "main-storyboard",
      title: "Main Storyboard",
    });
    expect(url).toBe(`/api/storyboards?world=${WORLD_ID}`);
    expect(init.headers).toEqual(
      expect.objectContaining({
        "Content-Type": "application/json",
        "If-Match": '"3"',
      }),
    );
    expect(body).toEqual(storyboardsFixture);
  });

  it("maps malformed JSON and revision disagreement to a stable application code", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response({ chapters: [] }))
        .mockResolvedValueOnce(response(manuscriptFixture, { ETag: '"9"' })),
    );

    await expect(application.manuscript.load()).rejects.toMatchObject({
      code: "invalid_response",
    });
    await expect(application.manuscript.load()).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("uses an ETag fallback only when it is a safe non-negative integer", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          response(envelopeWithoutRevision(), { ETag: `"${Number.MAX_SAFE_INTEGER}"` }),
        )
        .mockResolvedValueOnce(
          response(envelopeWithoutRevision(), { ETag: `"${Number.MAX_SAFE_INTEGER + 1}"` }),
        )
        .mockResolvedValueOnce(response(envelopeWithoutRevision(), { ETag: '"Infinity"' })),
    );

    await expect(application.manuscript.load()).resolves.toBeDefined();
    await expect(application.manuscript.load()).rejects.toMatchObject({
      code: "invalid_response",
    });
    await expect(application.manuscript.load()).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("rejects a save response whose ETag disagrees with its revision", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(manuscriptFixture, { ETag: '"7"' }))
        .mockResolvedValueOnce(
          response({ ok: true, zeit: "12:00:00", revision: 8 }, { ETag: '"9"' }),
        ),
    );

    const manuscript = await application.manuscript.load();
    await expect(application.manuscript.save(manuscript)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("preserves the structured revision conflict returned by a save", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(manuscriptFixture, { ETag: '"7"' }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: false, error: revisionConflict }), {
            status: 409,
            headers: { "Content-Type": "application/json" },
          }),
        ),
    );

    const manuscript = await application.manuscript.load();

    await expect(application.manuscript.save(manuscript)).rejects.toMatchObject({
      code: "document.revision_conflict",
      category: "conflict",
      params: { document: "manuscript", expected: 11, actual: 12 },
      retryable: true,
    });
  });

  it("peeks at a persisted revision without changing the active write revision", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(manuscriptFixture, { ETag: '"7"' }))
      .mockResolvedValueOnce(response(manuscriptAtRevision(9), { ETag: '"9"' }))
      .mockResolvedValueOnce(response({ ok: true, zeit: "12:00:00", revision: 8 }));
    vi.stubGlobal("fetch", fetchMock);

    const local = await application.manuscript.load();
    const persisted = await application.manuscript.peek();
    await application.manuscript.save(local);

    expect(persisted.revision).toBe(9);
    expect((fetchMock.mock.calls[2][1] as RequestInit).headers).toEqual(
      expect.objectContaining({ "If-Match": '"7"' }),
    );
  });

  it("revalidates an explicitly reviewed revision when resolving a conflict", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(manuscriptFixture, { ETag: '"7"' }))
      .mockResolvedValueOnce(response(manuscriptAtRevision(8), { ETag: '"8"' }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, error: revisionConflict }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const local = await application.manuscript.load();
    const reviewed = await application.manuscript.peek();
    await expect(
      application.manuscript.saveExpected(local, reviewed.revision),
    ).rejects.toMatchObject({ category: "conflict" });
    expect((fetchMock.mock.calls[2][1] as RequestInit).headers).toEqual(
      expect.objectContaining({ "If-Match": '"8"' }),
    );
  });

  it("adopts a reviewed persisted revision only through the explicit adoption step", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(manuscriptFixture, { ETag: '"7"' }))
      .mockResolvedValueOnce(response(manuscriptAtRevision(9), { ETag: '"9"' }))
      .mockResolvedValueOnce(response({ ok: true, zeit: "12:00:00", revision: 10 }));
    vi.stubGlobal("fetch", fetchMock);

    await application.manuscript.load();
    const reviewed = await application.manuscript.peek();
    const adopted = application.manuscript.adoptPersisted(reviewed);
    await application.manuscript.save(adopted);

    expect((fetchMock.mock.calls[2][1] as RequestInit).headers).toEqual(
      expect.objectContaining({ "If-Match": '"9"' }),
    );
  });

  it("does not adopt late load revisions across world selection generations", async () => {
    const firstA = deferred<Response>();
    const worldB = deferred<Response>();
    const secondA = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(firstA.promise)
      .mockReturnValueOnce(worldB.promise)
      .mockReturnValueOnce(secondA.promise)
      .mockResolvedValueOnce(response({ ok: true, zeit: "12:00:00", revision: 31 }));
    vi.stubGlobal("fetch", fetchMock);

    const oldA = application.manuscript.load();
    application.worlds.select("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    const loadB = application.manuscript.load();
    application.worlds.select(WORLD_ID);
    const currentA = application.manuscript.load();

    secondA.resolve(response(manuscriptAtRevision(30), { ETag: '"30"' }));
    await currentA;
    worldB.resolve(response(manuscriptAtRevision(20), { ETag: '"20"' }));
    await loadB;
    firstA.resolve(response(manuscriptAtRevision(10), { ETag: '"10"' }));
    const manuscript = await oldA;
    await application.manuscript.save(manuscript);

    expect(fetchMock.mock.calls.slice(0, 3).map(([url]) => url)).toEqual([
      `/api/manuscript?world=${WORLD_ID}`,
      "/api/manuscript?world=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      `/api/manuscript?world=${WORLD_ID}`,
    ]);
    expect((fetchMock.mock.calls[3][1] as RequestInit).headers).toEqual(
      expect.objectContaining({ "If-Match": '"30"' }),
    );
  });

  it("does not adopt a late save revision after selecting another world", async () => {
    const lateSave = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(manuscriptFixture, { ETag: '"7"' }))
      .mockReturnValueOnce(lateSave.promise)
      .mockResolvedValueOnce(response(manuscriptAtRevision(3), { ETag: '"3"' }))
      .mockResolvedValueOnce(response({ ok: true, zeit: "12:00:00", revision: 4 }));
    vi.stubGlobal("fetch", fetchMock);

    const manuscriptA = await application.manuscript.load();
    const savingA = application.manuscript.save(manuscriptA);
    application.worlds.select("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    const manuscriptB = await application.manuscript.load();
    lateSave.resolve(response({ ok: true, zeit: "12:00:00", revision: 8 }));
    await savingA;
    await application.manuscript.save(manuscriptB);

    expect(fetchMock.mock.calls[1][0]).toBe(`/api/manuscript?world=${WORLD_ID}`);
    expect((fetchMock.mock.calls[3][1] as RequestInit).headers).toEqual(
      expect.objectContaining({ "If-Match": '"3"' }),
    );
  });

  it("does not adopt a peek result from an earlier world selection", async () => {
    const latePeek = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(latePeek.promise)
      .mockResolvedValueOnce(response(manuscriptAtRevision(3), { ETag: '"3"' }))
      .mockResolvedValueOnce(response({ ok: true, zeit: "12:00:00", revision: 4 }));
    vi.stubGlobal("fetch", fetchMock);

    const peekedA = application.manuscript.peek();
    application.worlds.select("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    const manuscriptB = await application.manuscript.load();
    latePeek.resolve(response(manuscriptAtRevision(9), { ETag: '"9"' }));
    const stalePersisted = await peekedA;
    let staleError: unknown;
    try {
      application.manuscript.adoptPersisted(stalePersisted);
    } catch (error) {
      staleError = error;
    }
    expect(staleError).toMatchObject({
      code: "document.revision_conflict",
      category: "conflict",
      retryable: true,
    });
    await application.manuscript.save(manuscriptB);

    expect((fetchMock.mock.calls[2][1] as RequestInit).headers).toEqual(
      expect.objectContaining({ "If-Match": '"3"' }),
    );
  });

  it("continues to adopt an explicit untracked persisted document", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: true, zeit: "12:00:00", revision: 12 }));
    vi.stubGlobal("fetch", fetchMock);
    const explicit = {
      document: { chapters: [] },
      revision: 11,
    };

    const adopted = application.manuscript.adoptPersisted(explicit);
    await application.manuscript.save(adopted);

    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toEqual(
      expect.objectContaining({ "If-Match": '"11"' }),
    );
  });
});
