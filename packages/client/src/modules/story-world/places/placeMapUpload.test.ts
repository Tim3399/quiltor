import { describe, expect, it } from "vitest";
import { MAX_MAP_IMAGE_BYTES, preparedMapImageIssue } from "./placeMapUpload";

function sizedBlob(prefix: number[], size: number, type = ""): Blob {
  return new Blob([Uint8Array.from(prefix), new Uint8Array(size - prefix.length)], { type });
}

describe("preparedMapImageIssue", () => {
  it.each([
    ["PNG", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ["JPEG", [0xff, 0xd8]],
    ["WebP", [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]],
  ])("accepts %s bytes independently of the declared MIME", async (_name, prefix) => {
    await expect(
      preparedMapImageIssue(new Blob([Uint8Array.from(prefix)], { type: "application/x-wrong" })),
    ).resolves.toBeNull();
  });

  it("accepts exactly 10 MiB and rejects the next byte", async () => {
    await expect(
      preparedMapImageIssue(sizedBlob([0xff, 0xd8], MAX_MAP_IMAGE_BYTES)),
    ).resolves.toBeNull();
    await expect(
      preparedMapImageIssue(sizedBlob([0xff, 0xd8], MAX_MAP_IMAGE_BYTES + 1)),
    ).resolves.toBe("too_large");
  });

  it.each([
    ["empty", []],
    ["truncated PNG", [0x89, 0x50, 0x4e, 0x47]],
    ["truncated WebP", [0x52, 0x49, 0x46, 0x46]],
    ["another format", [0, 1, 2, 3, 4, 5, 6, 7]],
  ])("rejects %s bytes", async (_name, bytes) => {
    await expect(preparedMapImageIssue(new Blob([Uint8Array.from(bytes)]))).resolves.toBe(
      "unsupported_format",
    );
  });
});
