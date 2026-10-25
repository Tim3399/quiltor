// Merges this run's capture parts into manifest.json once every capture project has finished.
import { mergeAuditParts, summarize } from "./merge.ts";

export default async function globalTeardown(): Promise<void> {
  const run = process.env.QUILTOR_AUDIT_RUN;
  if (!run) return;
  const manifest = await mergeAuditParts(run);
  // A run without capture projects (rules only) writes no manifest.
  if (manifest) console.log(summarize(manifest));
}
