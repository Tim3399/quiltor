import type { ApplicationErrorCategory } from "../../shared";

export type ApplicationGatewayErrorOptions = {
  category?: ApplicationErrorCategory;
  params?: Readonly<Record<string, unknown>>;
  retryable?: boolean;
};

const categories = new Set<ApplicationErrorCategory>([
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "invalid_request",
  "invalid_response",
  "unavailable",
  "unknown",
]);

function categoryForLocalCode(code: string): ApplicationErrorCategory {
  return categories.has(code as ApplicationErrorCategory)
    ? (code as ApplicationErrorCategory)
    : "unknown";
}

export class ApplicationGatewayError extends Error {
  readonly category: ApplicationErrorCategory;
  readonly params: Readonly<Record<string, unknown>>;
  readonly retryable: boolean;

  constructor(
    message: string,
    /** Stable transport/application contract code, when one was supplied. */
    readonly code: string = "unknown",
    options: ApplicationGatewayErrorOptions = {},
  ) {
    super(message);
    this.name = "ApplicationGatewayError";
    this.category = options.category ?? categoryForLocalCode(code);
    this.params = Object.freeze({ ...(options.params ?? {}) });
    this.retryable = options.retryable ?? false;
  }
}

export function applicationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
