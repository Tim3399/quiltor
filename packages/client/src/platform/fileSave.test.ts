import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlatformGateway } from "./createPlatformGateway";
import { saveTextFile } from "./fileSave";

type Bridge = { invoke: ReturnType<typeof vi.fn> };

function installBridge(invoke: Bridge["invoke"]) {
  (window as unknown as { pywebview?: { api: Bridge } }).pywebview = { api: { invoke } };
}

function response(status: "saved" | "cancelled") {
  return vi
    .fn()
    .mockImplementation((request) =>
      Promise.resolve({ version: 1, id: request.id, ok: true, result: { status } }),
    );
}

afterEach(() => {
  delete (window as unknown as { pywebview?: unknown }).pywebview;
  vi.restoreAllMocks();
});

describe("host file save", () => {
  it("downloads through an anchor in the browser", async () => {
    let download = "";
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      download = this.download;
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    await saveTextFile(
      createPlatformGateway(),
      "Prolog / Rückkehr.md",
      "# Kapitel\n",
      "Export failed",
    );
    expect(click).toHaveBeenCalledOnce();
    expect(download).toBe("Prolog - Rückkehr.md");
  });

  it("hands the export to the native bridge in the desktop app instead of to an anchor", async () => {
    // An <a download> is, in the desktop app, precisely the path that produces nothing and
    // on macOS blocks the window as well -- see src/quiltor/hosts/desktop/bridge/api.py.
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const save = response("saved");
    installBridge(save);
    await saveTextFile(
      createPlatformGateway(),
      "Prolog / Rückkehr.md",
      "# Kapitel\n",
      "Export failed",
    );
    expect(click).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        operation: "file.save",
        payload: {
          name: "Prolog - Rückkehr.md",
          content: btoa("# Kapitel\n"),
          encoding: "base64",
        },
      }),
    );
  });

  it("stays quiet when the save dialog is cancelled", async () => {
    installBridge(response("cancelled"));
    await expect(
      saveTextFile(createPlatformGateway(), "Kapitel.md", "Text", "Export failed"),
    ).resolves.toBeUndefined();
  });

  it("reports a failed export instead of swallowing it", async () => {
    installBridge(
      vi.fn().mockImplementation((request) =>
        Promise.resolve({
          version: 1,
          id: request.id,
          ok: false,
          error: { code: "file.write_failed", retryable: true },
        }),
      ),
    );
    await expect(
      saveTextFile(createPlatformGateway(), "Kapitel.md", "Text", "Export failed"),
    ).rejects.toThrow("Export failed");
  });

  it("reports a bridge failure without a verdict too", async () => {
    installBridge(vi.fn().mockRejectedValue(new Error("bridge is gone")));
    await expect(
      saveTextFile(createPlatformGateway(), "Kapitel.md", "Text", "Export failed"),
    ).rejects.toThrow("Export failed");
  });
});
