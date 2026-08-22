import type { PlatformGateway } from "./PlatformGateway";

export async function saveBlob(
  platform: PlatformGateway,
  name: string,
  blob: Blob,
  fallbackError: string,
): Promise<void> {
  const result = await platform.files.save(name, blob);
  if (result.status === "saved" || result.status === "cancelled") return;
  throw new Error(result.error || fallbackError);
}

export function saveTextFile(
  platform: PlatformGateway,
  name: string,
  content: string,
  fallbackError: string,
  type = "text/plain;charset=utf-8",
): Promise<void> {
  return saveBlob(platform, name, new Blob([content], { type }), fallbackError);
}
