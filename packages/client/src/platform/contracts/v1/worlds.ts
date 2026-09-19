import type { WorldInfo } from "../../../modules/story-world";

export interface WorldInfoWireV1 {
  id: string;
  title: string;
  backupUrl: string;
  updated: string;
  deletedAt?: string;
}

export function decodeWorldInfoV1(value: unknown): WorldInfo {
  const wire = requireWorldInfo(value);
  return {
    id: wire.id,
    title: wire.title,
    backupUrl: wire.backupUrl,
    updated: wire.updated,
  };
}

export function decodeTrashedWorldInfoV1(value: unknown): WorldInfo & { deletedAt: string } {
  const wire = requireWorldInfo(value);
  if (
    typeof wire.deletedAt !== "string" ||
    !wire.deletedAt.trim() ||
    Number.isNaN(Date.parse(wire.deletedAt))
  ) {
    throw new TypeError("Invalid trashed world wire value");
  }
  return { ...decodeWorldInfoV1(wire), deletedAt: wire.deletedAt };
}

function requireWorldInfo(value: unknown): WorldInfoWireV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid world wire value");
  }
  const wire = value as Partial<WorldInfoWireV1>;
  if (
    typeof wire.id !== "string" ||
    typeof wire.title !== "string" ||
    typeof wire.backupUrl !== "string" ||
    typeof wire.updated !== "string" ||
    (wire.deletedAt !== undefined &&
      (typeof wire.deletedAt !== "string" || Number.isNaN(Date.parse(wire.deletedAt))))
  ) {
    throw new TypeError("Invalid world wire value");
  }
  return wire as WorldInfoWireV1;
}
