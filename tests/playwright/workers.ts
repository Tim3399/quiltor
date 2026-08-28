export function resolvePlaywrightWorkers(defaultWorkers: number): number {
  const configured = process.env.PLAYWRIGHT_WORKERS?.trim();
  if (!configured) return defaultWorkers;

  const workers = Number(configured);
  if (!/^[1-9]\d*$/.test(configured) || !Number.isSafeInteger(workers)) {
    throw new Error("PLAYWRIGHT_WORKERS must be a positive integer.");
  }
  return workers;
}
