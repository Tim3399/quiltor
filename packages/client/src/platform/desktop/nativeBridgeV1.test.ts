import { afterEach, describe, expect, it, vi } from "vitest";
import requestFixture from "../../../../../contracts/fixtures/native-bridge/request.v1.json";
import successFixture from "../../../../../contracts/fixtures/native-bridge/success.v1.json";
import errorFixture from "../../../../../contracts/fixtures/native-bridge/error.v1.json";
import manifest from "../../../../../contracts/manifest.json";
import schema from "../../../../../contracts/native-bridge/v1.schema.json";
import { desktopFileGateway } from "./desktopFileGateway";
import type { NativeBridgeV1 } from "./nativeBridgeV1";

function installBridge(invoke: ReturnType<typeof vi.fn>) {
  window.pywebview = { api: { invoke: invoke as NativeBridgeV1["invoke"] } };
}

afterEach(() => {
  delete window.pywebview;
  vi.restoreAllMocks();
});

describe("native bridge v1", () => {
  it("builds the registered file.save request and correlates its success response", async () => {
    const invoke = vi.fn().mockResolvedValue(successFixture);
    installBridge(invoke);
    const gateway = desktopFileGateway(() => requestFixture.id);

    await expect(gateway?.save("Kapitel.md", new Blob(["# Kapitel\n"]))).resolves.toEqual({
      status: "saved",
    });
    expect(invoke).toHaveBeenCalledWith(requestFixture);
  });

  it("keeps structured native error codes intact", async () => {
    installBridge(vi.fn().mockResolvedValue(errorFixture));
    const gateway = desktopFileGateway(() => errorFixture.id);

    await expect(gateway?.save("Kapitel.md", new Blob(["Text"]))).resolves.toEqual({
      status: "failed",
      code: "file.write_failed",
    });
  });

  it("turns rejected bridge promises into a stable local code", async () => {
    installBridge(vi.fn().mockRejectedValue(new Error("C:/private/traceback.py:42")));
    const gateway = desktopFileGateway(() => "request-rejected");

    await expect(gateway?.save("Kapitel.md", new Blob(["Text"]))).resolves.toEqual({
      status: "failed",
      code: "native_bridge.invoke_failed",
    });
  });

  it.each([
    { ...successFixture, id: "another-request" },
    { ...successFixture, version: 2 },
    { ...successFixture, legacyPath: "C:/private/book.md" },
    {
      version: 1,
      id: successFixture.id,
      ok: false,
      error: { code: "file.write_failed", retryable: true, traceback: "private" },
    },
    {
      version: 1,
      id: successFixture.id,
      ok: false,
      error: {
        code: "file.write_failed",
        retryable: true,
        params: { traceback: "C:/private/bridge.py" },
      },
    },
  ])("rejects a response outside the strict v1 envelope", async (response) => {
    installBridge(vi.fn().mockResolvedValue(response));
    const gateway = desktopFileGateway(() => successFixture.id);

    await expect(gateway?.save("Kapitel.md", new Blob(["Text"]))).resolves.toEqual({
      status: "failed",
      code: "native_bridge.invalid_response",
    });
  });

  it("pins the request fields and file.save operation to the registered schema", () => {
    const contract = manifest.contracts.find((item) => item.name === "host.native-bridge");
    const request = schema.$defs.request;
    expect(contract?.schema).toBe("native-bridge/v1.schema.json");
    expect(contract?.fixtures.map((fixture) => fixture.path)).toEqual([
      "fixtures/native-bridge/request.v1.json",
      "fixtures/native-bridge/success.v1.json",
      "fixtures/native-bridge/error.v1.json",
    ]);
    expect(request.required).toEqual(["version", "id", "operation", "payload"]);
    expect(request.properties.version.const).toBe(1);
    expect(request.properties.operation.const).toBe("file.save");
    expect(schema.$defs.fileSavePayload.required).toEqual(["name", "content", "encoding"]);
    expect(schema.$defs.fileSavePayload.properties.encoding.const).toBe("base64");
    expect(schema.$defs.nativeError.properties.params.oneOf).toHaveLength(2);
    expect(schema.$defs.nativeError.properties.params.oneOf).toEqual(
      expect.arrayContaining([expect.objectContaining({ additionalProperties: false })]),
    );
  });
});
