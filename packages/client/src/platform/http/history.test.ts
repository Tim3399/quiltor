import { afterEach, describe, expect, it, vi } from "vitest";
import { createHistoryHttpGateway } from "./history";
import { createHttpApplicationState } from "./request";

const WORLD_ID = "world with / reserved?";

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("history HTTP port", () => {
  it("encodes history selectors and appends the selected world to existing queries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: true, commits: [] }))
      .mockResolvedValueOnce(
        response({ ok: true, diff: "difference", newFiles: ["Kapitel 1"], mode: "line" }),
      )
      .mockResolvedValueOnce(response({ ok: true, isNew: false, text: "Historischer Text" }));
    vi.stubGlobal("fetch", fetchMock);
    const state = createHttpApplicationState();
    state.activeWorldId = WORLD_ID;
    const history = createHistoryHttpGateway(state);

    await history.log();
    await expect(history.diff("feature/Änderung?", false, true)).resolves.toEqual({
      ok: true,
      diff: "difference",
      newFiles: ["Kapitel 1"],
      mode: "line",
    });
    await history.textVersion("HEAD~1", 7, "Ankunft & Abschied");

    const encodedWorld = encodeURIComponent(WORLD_ID);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `/api/history?world=${encodedWorld}`,
      `/api/history/diff?ref=${encodeURIComponent("feature/Änderung?")}&mode=line&all=1&world=${encodedWorld}`,
      `/api/history/chapter-text?ref=${encodeURIComponent("HEAD~1")}&chapter=7&title=${encodeURIComponent("Ankunft & Abschied")}&world=${encodedWorld}`,
    ]);
  });

  it("uses the public diff defaults without inventing world scope", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response({ ok: true, diff: "", newFiles: [], mode: "word" }));
    vi.stubGlobal("fetch", fetchMock);

    await createHistoryHttpGateway(createHttpApplicationState()).diff();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/history/diff?ref=WORK&mode=word&all=0",
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});
