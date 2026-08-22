export type WireRecord = Record<string, unknown>;

export class WireContractError extends Error {
  constructor(readonly path: string) {
    super(`Invalid v1 wire value at ${path}.`);
    this.name = "WireContractError";
  }
}

export function wireRecord(value: unknown, path: string): WireRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new WireContractError(path);
  }
  return value as WireRecord;
}

export function wireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new WireContractError(path);
  return value;
}

export function wireString(
  value: unknown,
  path: string,
  options: { min?: number; max?: number } = {},
): string {
  const codePointLength = typeof value === "string" ? [...value].length : -1;
  if (
    typeof value !== "string" ||
    (options.min !== undefined && codePointLength < options.min) ||
    (options.max !== undefined && codePointLength > options.max)
  ) {
    throw new WireContractError(path);
  }
  return value;
}

export function wireNumber(
  value: unknown,
  path: string,
  options: { min?: number; max?: number; exclusiveMin?: number } = {},
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (options.min !== undefined && value < options.min) ||
    (options.max !== undefined && value > options.max) ||
    (options.exclusiveMin !== undefined && value <= options.exclusiveMin)
  ) {
    throw new WireContractError(path);
  }
  return value;
}

export function wireInteger(
  value: unknown,
  path: string,
  options: { min?: number; max?: number } = {},
): number {
  const number = wireNumber(value, path, options);
  if (!Number.isSafeInteger(number)) throw new WireContractError(path);
  return number;
}

export function wireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new WireContractError(path);
  return value;
}

export function wireEnum<const T extends readonly string[]>(
  value: unknown,
  values: T,
  path: string,
): T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new WireContractError(path);
  }
  return value as T[number];
}

export function optional(
  record: WireRecord,
  key: string,
  validate: (value: unknown, path: string) => unknown,
  path: string,
): void {
  if (record[key] !== undefined) validate(record[key], `${path}.${key}`);
}
