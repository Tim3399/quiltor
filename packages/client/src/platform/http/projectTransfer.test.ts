import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectTransferHttpGateway } from "./projectTransfer";

afterEach(() => vi.unstubAllGlobals());

const preview = {
  title: "Die Stadt",
  counts: {
    chapters: 4,
    bookChapters: 2,
    setAsideChapters: 1,
    trashedChapters: 1,
    figures: 3,
    storyboards: 2,
    images: 5,
  },
  includes: { trash: true, history: false },
};

describe("project transfer HTTP gateway", () => {
  it("transfers the archive as binary and decodes preview and imported ownership", async () => {
    const archive = new Blob(["archive"], { type: "application/x-custom-quiltor" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([80, 75, 3, 4]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, preview }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            world: {
              id: "new-owned-id",
              title: "Die Stadt",
              backupUrl: "",
              updated: "2026-09-19T12:00:00Z",
            },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const gateway = createProjectTransferHttpGateway();

    await expect(gateway.exportProject("world / one")).resolves.toMatchObject({ size: 4 });
    await expect(gateway.preview(archive)).resolves.toEqual({ ok: true, preview });
    await expect(gateway.importProject(archive)).resolves.toMatchObject({
      ok: true,
      world: { id: "new-owned-id", title: "Die Stadt" },
    });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/project-transfer/export?world=world%20%2F%20one");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: archive,
    });
  });

  it("preserves a safe structured archive error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "project_transfer.invalid_archive", retryable: false },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(createProjectTransferHttpGateway().preview(new Blob([]))).rejects.toMatchObject({
      code: "project_transfer.invalid_archive",
      message: "Die Projektdatei ist ungültig oder beschädigt. Es wurde nichts importiert.",
    });
  });
});
