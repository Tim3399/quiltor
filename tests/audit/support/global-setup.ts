// Stamps the run, so the teardown merges only parts written by this run. Nothing is deleted here:
// a run of the "rules" project alone must leave the previous capture output alone.
export const RUN_ENV = "QUILTOR_AUDIT_RUN";

export default function globalSetup(): void {
  process.env[RUN_ENV] = String(Date.now());
}
