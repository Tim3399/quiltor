import { checkPlatformBoundaries } from "./platform_boundaries.mjs";

const violations = checkPlatformBoundaries(process.cwd());

if (violations.length) {
  console.error(`Platform boundary violations (${violations.length}):\n${violations.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(
    "Platform-dependent capabilities are isolated behind PlatformGateway; no client code names the operation profile or branches on multiUser.",
  );
}
