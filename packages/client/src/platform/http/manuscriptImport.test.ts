import { afterEach, describe, expect, it, vi } from "vitest";
import { createManuscriptImportHttpGateway } from "./manuscriptImport";

const source = {
  fileName: "Hafen.docx",
  size: 4,
  content: new Blob(["docx"]),
};

const preview = {
  format: "docx",
  fileName: "Hafen.docx",
  sourceSha256: "a".repeat(64),
  title: "Hafenroman",
  units: [
    {
      index: 0,
      text: "😀 Mara wartet.",
      marks: [
        { from: 3, to: 7, kind: "bold" },
        { from: 8, to: 14, kind: "italic" },
      ],
      isHeading: true,
    },
  ],
  chapters: [
    {
      sourceIndexes: [0],
      title: "Ankunft",
      folderPath: ["Teil 1"],
      body: "😀 Mara wartet.",
      marks: [
        { from: 3, to: 7, kind: "bold" },
        { from: 8, to: 14, kind: "italic" },
      ],
    },
  ],
  counts: {
    sourceWords: 3,
    sourceParagraphs: 1,
    importedWords: 3,
    importedParagraphs: 1,
  },
  warnings: [{ code: "comments", count: 2 }],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("manuscript import HTTP gateway", () => {
  it.each([
    ["Draft.md", "markdown"],
    ["Draft.markdown", "markdown"],
    ["Draft.txt", "txt"],
    ["Draft.docx", "docx"],
  ])("accepts a consistent %s preview", async (fileName, format) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ ok: true, preview: { ...preview, fileName, format } })),
    );

    await expect(
      createManuscriptImportHttpGateway().preview({ ...source, fileName }),
    ).resolves.toMatchObject({ preview: { fileName, format } });
  });

  it("encodes DOCX bytes and sends the exact reviewed selection and stable request id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ ok: true, preview }))
      .mockResolvedValueOnce(
        json(
          {
            ok: true,
            world: {
              id: "new-world",
              title: "Hafenroman",
              backupUrl: "",
              updated: "2026-10-02T12:00:00Z",
            },
          },
          201,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const gateway = createManuscriptImportHttpGateway(() => "request-fixed");
    const selection = {
      title: "Hafenroman",
      chapters: [{ sourceIndexes: [0], title: "Ankunft", folderPath: ["Teil 1"] }],
    };

    await expect(gateway.preview(source, selection)).resolves.toEqual({ ok: true, preview });
    await expect(
      gateway.importManuscript({
        source,
        sourceSha256: preview.sourceSha256,
        ...selection,
        acknowledgedWarnings: ["comments"],
        requestId: gateway.createRequestId(),
      }),
    ).resolves.toMatchObject({ ok: true, world: { id: "new-world" } });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      fileName: "Hafen.docx",
      dataBase64: "ZG9jeA==",
      selection,
    });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/manuscript-import/v2/preview");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      fileName: "Hafen.docx",
      dataBase64: "ZG9jeA==",
      sourceSha256: preview.sourceSha256,
      ...selection,
      acknowledgedWarnings: ["comments"],
      requestId: "request-fixed",
    });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/manuscript-import/v2/import");
  });

  it.each([
    ["unknown warning", { warnings: [{ code: "macros", count: 1 }] }],
    ["zero warning count", { warnings: [{ code: "comments", count: 0 }] }],
    ["gapped source indexes", { chapters: [{ ...preview.chapters[0], sourceIndexes: [1] }] }],
    ["gapped unit indexes", { units: [{ ...preview.units[0], index: 1 }] }],
    ["missing partition unit", { units: [...preview.units, { ...preview.units[0], index: 1 }] }],
    ["invalid folder path", { chapters: [{ ...preview.chapters[0], folderPath: [""] }] }],
    [
      "deep folder path",
      { chapters: [{ ...preview.chapters[0], folderPath: Array(9).fill("Folder") }] },
    ],
    ["format and filename mismatch", { format: "txt" }],
    ["invalid unit heading flag", { units: [{ ...preview.units[0], isHeading: "yes" }] }],
    [
      "split unit surrogate",
      { units: [{ ...preview.units[0], marks: [{ from: 1, to: 2, kind: "bold" }] }] },
    ],
    ["unit count mismatch", { counts: { ...preview.counts, sourceParagraphs: 2 } }],
    [
      "split surrogate",
      { chapters: [{ ...preview.chapters[0], marks: [{ from: 1, to: 2, kind: "bold" }] }] },
    ],
    [
      "overlapping same-kind marks",
      {
        chapters: [
          {
            ...preview.chapters[0],
            marks: [
              { from: 3, to: 9, kind: "bold" },
              { from: 8, to: 12, kind: "bold" },
            ],
          },
        ],
      },
    ],
    ["blank title", { title: " " }],
  ])("rejects a malformed %s response", async (_name, change) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ ok: true, preview: { ...preview, ...change } })),
    );

    await expect(createManuscriptImportHttpGateway().preview(source)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("rejects an ordered chapter partition that omits the final source unit", async () => {
    const secondUnit = {
      index: 1,
      text: "Der zweite Absatz bleibt übrig.",
      marks: [],
      isHeading: false,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json({
          ok: true,
          preview: {
            ...preview,
            units: [...preview.units, secondUnit],
            counts: { ...preview.counts, sourceParagraphs: 2 },
          },
        }),
      ),
    );

    await expect(createManuscriptImportHttpGateway().preview(source)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("rejects oversized input before reading or sending it", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createManuscriptImportHttpGateway().preview({ ...source, size: 8 * 1024 * 1024 + 1 }),
    ).rejects.toMatchObject({ code: "manuscript_import.limit_exceeded" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_file", "ungültig"],
    ["limit_exceeded", "Größe"],
    ["unsupported_content", "nicht sicher"],
    ["invalid_selection", "Kapitelaufteilung"],
    ["preview_mismatch", "Vorschau"],
    ["warnings_unacknowledged", "Bestätige"],
    ["conflicting_request", "Importversuch"],
    ["publication_failed", "vollständig erstellt"],
  ])("localizes manuscript_import.%s", async (suffix, message) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          json({ error: { code: `manuscript_import.${suffix}`, retryable: false } }, 400),
        ),
    );

    await expect(createManuscriptImportHttpGateway().preview(source)).rejects.toMatchObject({
      code: `manuscript_import.${suffix}`,
      message: expect.stringContaining(message),
    });
  });
});
