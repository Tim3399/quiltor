// The design gallery's port, shared by vite.design.config.ts and playwright.design.config.ts.
//
// QUILTOR_DESIGN_PORT picks it, so two worktrees can run the design suite side by side. The
// default stays 4174. The Playwright config never reuses a server already on that port: a
// gallery from another worktree serves that worktree's sources, and reusing it produced runs
// with dozens of red tests that had nothing to do with the change under test (T-101, T-119).

export const DEFAULT_DESIGN_PORT = 4174;

export function resolveDesignPort(env = process.env) {
  const raw = env.QUILTOR_DESIGN_PORT;
  if (raw === undefined || raw === "") return DEFAULT_DESIGN_PORT;
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || port < 1024 || port > 65535) {
    throw new Error(`QUILTOR_DESIGN_PORT must be a port between 1024 and 65535, got "${raw}"`);
  }
  return port;
}
