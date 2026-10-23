// Placeholder from the T-1 scaffold. Part B replaces the body; the signature is the contract
// that part A calls.
import type { Page } from "@playwright/test";
import type { Finding, LayoutContext } from "./types";

export async function analyzeLayout(_page: Page, _ctx: LayoutContext): Promise<Finding[]> {
  return [];
}
