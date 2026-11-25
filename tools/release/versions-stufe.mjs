// The version stage (T-364, D-249), set up so that it can be repeated on any commit:
//
//   node tools/release/versions-stufe.mjs [--sha <rev>] [--out <dir>] [--proxies caddy,nginx]
//
// For the given commit it
//   1. builds the release image from that commit's tree (`git archive` as the build context),
//   2. prints the sample world and the large world for the exports,
//   3. starts the image hosted -- QUILTOR_PUBLIC_URL set, origin check on, the release's
//      seccomp profile, Docker's default /dev/shm -- behind each proxy in turn,
//   4. times PDF, DOCX, EPUB and Markdown for both worlds (stage-exports.mjs),
//   5. runs a selection of the product specs against the proxy (PLAYWRIGHT_BASE_URL),
//   6. walks the route and takes one picture per station (stage-rundgang.mjs),
// and writes protocol.md and protocol.json into the output directory.
//
// Nothing is pulled and nothing is pushed. Containers, network and volume carry the prefix
// `t364-` and are removed at the end, also after a failure. The image `quiltor:t364-vorlauf`
// stays until --remove-image says otherwise, so a repeat run can use --skip-build.
//
// The hosted mode here has a local identity: no OIDC issuer, which the product allows. What
// the stage proves is the hosted transport -- public URL, origin check, proxy compression,
// the renderer inside the image -- not the sign-in.

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const KB = "C:/Users/timra/git/quiltor-kb";

const { values } = parseArgs({
  options: {
    sha: { type: "string", default: "HEAD" },
    out: { type: "string" },
    proxies: { type: "string", default: "caddy,nginx" },
    "large-ref": { type: "string", default: "origin/agent-team-einrichtung" },
    "skip-build": { type: "boolean", default: false },
    "skip-specs": { type: "boolean", default: false },
    "skip-rundgang": { type: "boolean", default: false },
    "skip-exports": { type: "boolean", default: false },
    "remove-image": { type: "boolean", default: false },
    "port-base": { type: "string", default: "18480" },
    image: { type: "string", default: "quiltor:t364-vorlauf" },
    "rundgang-dir": { type: "string" },
  },
});

const IMAGE = values.image;
// The local identity of the hosted container: a 64-character hex token, new for every run and
// never written to the protocol. The scripts send it as a bearer token.
const STAGE_TOKEN = randomBytes(32).toString("hex");
const PREFIX = "t364-";
const NETWORK = `${PREFIX}net`;
const VOLUME = `${PREFIX}data`;
const APP = `${PREFIX}app`;
const PROXY = `${PREFIX}proxy`;
const SPECS = [
  "editor-session-state",
  "save-error-id",
  "document-load-guard",
  "example-world",
  "example-world-preview",
  "manuscript-import",
  "manuscript-export",
  "manuscript-epub-export",
  "print-preview",
].map((name) => `tests/e2e/${name}.spec.ts`);

const port = Number(values["port-base"]);
if ([8000, 8010].some((forbidden) => port <= forbidden && forbidden < port + 10)) {
  throw new Error("The stage must not use ports 8000 or 8010.");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  });
  return result;
}
const git = (...args) => run("git", args, { cwd: root });
const docker = (...args) => run("docker", args);

function sha(revision) {
  const result = git("rev-parse", "--verify", `${revision}^{commit}`);
  if (result.status !== 0) throw new Error(`Unknown revision ${revision}: ${result.stderr}`);
  return result.stdout.trim();
}

const commit = sha(values.sha);
const tree = git("rev-parse", `${commit}^{tree}`).stdout.trim();
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = resolve(values.out ?? `${KB}/dev/D-T-364-B/${commit.slice(0, 8)}-${stamp}`);
mkdirSync(outDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "t364-"));
const protocol = { commit, tree, startedAt: new Date().toISOString(), steps: [], proxies: {} };
const logLines = [];

function log(message) {
  const line = `${new Date().toISOString().slice(11, 19)} ${message}`;
  console.log(line);
  logLines.push(line);
}
function step(name, details) {
  protocol.steps.push({ name, ...details });
}

function waitUntil(description, probe, seconds) {
  const deadline = Date.now() + seconds * 1000;
  return (async () => {
    while (Date.now() < deadline) {
      try {
        if (await probe()) return;
      } catch {
        // not yet
      }
      await new Promise((done) => setTimeout(done, 1000));
    }
    throw new Error(`Timed out after ${seconds} s waiting for ${description}.`);
  })();
}

// ---------------------------------------------------------------------------- 1. image

async function buildImage() {
  const version = readFileSync(join(root, "VERSION"), "utf8").trim();
  const started = Date.now();
  log(`building ${IMAGE} from ${commit.slice(0, 8)} (tree ${tree.slice(0, 8)})`);
  const archive = spawn("git", ["archive", "--format=tar", commit], { cwd: root });
  const build = spawn(
    "docker",
    [
      "build",
      "--pull=false",
      "-t",
      IMAGE,
      "--build-arg",
      `QUILTOR_VERSION=${version}`,
      "--build-arg",
      `QUILTOR_REVISION=${commit.slice(0, 8)}`,
      "-",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  archive.stdout.pipe(build.stdin);
  let tail = "";
  const keep = (chunk) => {
    tail = (tail + chunk.toString()).slice(-6000);
  };
  build.stdout.on("data", keep);
  build.stderr.on("data", keep);
  const code = await new Promise((done) => build.on("close", done));
  writeFileSync(join(outDir, "build-tail.log"), tail);
  const seconds = Math.round((Date.now() - started) / 1000);
  if (code !== 0) throw new Error(`docker build failed (exit ${code}); see build-tail.log`);
  const size = Number(docker("image", "inspect", IMAGE, "--format", "{{.Size}}").stdout.trim());
  step("build", { image: IMAGE, seconds, sizeBytes: size });
  log(`image built in ${seconds} s, ${(size / 1e6).toFixed(0)} MB`);
}

// ---------------------------------------------------------------------------- 2. worlds

function exportWorlds() {
  const sampleTree = join(work, "sample");
  const largeTree = join(work, "large");
  mkdirSync(sampleTree, { recursive: true });
  mkdirSync(largeTree, { recursive: true });
  const extract = (revision, target) => {
    const archive = run("git", ["archive", "--format=tar", revision, "tests/world"], {
      cwd: root,
      encoding: "buffer",
    });
    if (archive.status !== 0) throw new Error(`git archive ${revision} tests/world failed`);
    // cwd instead of -C: GNU tar reads "C:\..." as host:path.
    const untar = spawnSync("tar", ["-xf", "-"], { input: archive.stdout, cwd: target });
    if (untar.status !== 0) throw new Error("tar failed");
  };
  extract(commit, sampleTree);
  const hasLarge = git("cat-file", "-e", `${commit}:tests/world/parts/large.mjs`).status === 0;
  const largeRevision = hasLarge ? commit : values["large-ref"];
  extract(largeRevision, largeTree);
  const printer = (tree, include) => `
    import { buildExampleWorld } from ${JSON.stringify(pathToFileURL(join(tree, "tests/world/index.mjs")).href)};
    process.stdout.write(JSON.stringify(buildExampleWorld("de", { include: ${JSON.stringify(include)} })));`;
  const sample = run("node", ["--input-type=module", "-e", printer(sampleTree, ["base"])], {
    cwd: sampleTree,
  });
  const large = run("node", ["--input-type=module", "-e", printer(largeTree, ["base", "large"])], {
    cwd: largeTree,
  });
  if (sample.status !== 0 || large.status !== 0)
    throw new Error(`world export failed: ${sample.stderr}${large.stderr}`);
  const files = { sample: join(work, "sample.json"), large: join(work, "large.json") };
  writeFileSync(files.sample, sample.stdout);
  writeFileSync(files.large, large.stdout);
  step("worlds", {
    sampleFrom: commit.slice(0, 8),
    largeFrom: hasLarge ? "this commit" : largeRevision,
    sampleBytes: sample.stdout.length,
    largeBytes: large.stdout.length,
  });
  log(
    `worlds exported: sample ${sample.stdout.length} B, large ${large.stdout.length} B (large from ${hasLarge ? "this commit" : largeRevision})`,
  );
  return files;
}

// ---------------------------------------------------------------------------- 3. hosting

function cleanup() {
  docker("rm", "-f", APP, PROXY);
  docker("network", "rm", NETWORK);
  docker("volume", "rm", "-f", VOLUME);
}

async function hostBehind(proxyName, proxyPort, body) {
  cleanup();
  const publicUrl = `http://127.0.0.1:${proxyPort}`;
  const checks = [
    docker("network", "create", NETWORK),
    docker("volume", "create", VOLUME),
    docker(
      "run",
      "-d",
      "--name",
      APP,
      "--network",
      NETWORK,
      "--security-opt",
      `seccomp=${join(root, "distribution/containers/seccomp-chromium.json")}`,
      "-e",
      `QUILTOR_PUBLIC_URL=${publicUrl}`,
      "-e",
      "QUILTOR_LOG_LEVEL=INFO",
      "-e",
      `QUILTOR_MASTER_TOKEN=${STAGE_TOKEN}`,
      "-v",
      `${VOLUME}:/data`,
      IMAGE,
    ),
  ];
  const failed = checks.find((check) => check.status !== 0);
  if (failed) throw new Error(`start failed: ${failed.stderr}`);
  const proxyArgs =
    proxyName === "caddy"
      ? [
          "-v",
          `${join(root, "tests/proxy/Caddyfile")}:/etc/caddy/Caddyfile:ro`,
          process.env.T364_CADDY_IMAGE ?? "36c24ad91a7f",
        ]
      : [
          "-v",
          `${join(root, "tests/proxy/nginx.conf")}:/etc/nginx/conf.d/default.conf:ro`,
          "nginx:1.28.0-alpine",
        ];
  const proxy = docker(
    "run",
    "-d",
    "--name",
    PROXY,
    "--network",
    NETWORK,
    "-p",
    `127.0.0.1:${proxyPort}:80`,
    ...proxyArgs,
  );
  if (proxy.status !== 0) throw new Error(`proxy start failed: ${proxy.stderr}`);
  try {
    await waitUntil(
      "Quiltor behind the proxy",
      async () => (await fetch(`${publicUrl}/api/version`)).ok,
      90,
    );
    log(`${proxyName}: Quiltor reachable at ${publicUrl}`);
    return await body(publicUrl);
  } finally {
    writeFileSync(
      join(outDir, `${proxyName}-app.log`),
      docker("logs", APP).stdout + docker("logs", APP).stderr,
    );
    writeFileSync(
      join(outDir, `${proxyName}-proxy.log`),
      docker("logs", PROXY).stdout + docker("logs", PROXY).stderr,
    );
    cleanup();
  }
}

function runNode(label, args, env = {}, logFile) {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn("node", args, {
      cwd: root,
      env: { ...process.env, QUILTOR_STAGE_TOKEN: STAGE_TOKEN, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => {
      writeFileSync(join(outDir, logFile), output);
      done({ label, code, seconds: Math.round((Date.now() - started) / 1000), output });
    });
  });
}

const playwrightCli = () => {
  for (let dir = root; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules/@playwright/test/cli.js");
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) throw new Error("@playwright/test not found above the repository.");
  }
};

// ---------------------------------------------------------------------------- main

let exitCode = 0;
try {
  if (!values["skip-build"]) await buildImage();
  else step("build", { skipped: true, image: IMAGE });
  if (docker("image", "inspect", IMAGE).status !== 0)
    throw new Error(`Image ${IMAGE} is missing; run without --skip-build.`);
  const worlds = exportWorlds();
  const proxies = values.proxies.split(",").filter(Boolean);
  for (const [index, proxyName] of proxies.entries()) {
    const proxyPort = port + 1 + index;
    const entry = {};
    protocol.proxies[proxyName] = entry;
    await hostBehind(proxyName, proxyPort, async (publicUrl) => {
      if (!values["skip-exports"]) {
        const result = await runNode(
          "exports",
          [
            join(here, "stage-exports.mjs"),
            "--base-url",
            publicUrl,
            "--world",
            `sample=${worlds.sample}`,
            "--world",
            `large=${worlds.large}`,
            "--out",
            join(outDir, `${proxyName}-exports.json`),
          ],
          {},
          `${proxyName}-exports.log`,
        );
        entry.exports = {
          exit: result.code,
          seconds: result.seconds,
          file: `${proxyName}-exports.json`,
        };
        log(`${proxyName}: exports exit ${result.code}\n${result.output.trim()}`);
        if (result.code !== 0) exitCode = 1;
      }
      if (!values["skip-specs"]) {
        const result = await runNode(
          "specs",
          [
            playwrightCli(),
            "test",
            "--config",
            join(here, "playwright.stage.config.ts"),
            "--project=wide",
            "--reporter=list",
            "--workers=2",
            `--output=${join(work, `results-${proxyName}`)}`,
            ...SPECS,
          ],
          { PLAYWRIGHT_BASE_URL: publicUrl },
          `${proxyName}-specs.log`,
        );
        const summary = result.output
          .split("\n")
          .filter((line) => /^\s+\d+ (passed|failed|skipped|flaky|did not run)/.test(line))
          .map((line) => line.trim());
        entry.specs = {
          exit: result.code,
          seconds: result.seconds,
          summary,
          file: `${proxyName}-specs.log`,
        };
        log(`${proxyName}: specs exit ${result.code} ${summary.join(", ")}`);
        if (result.code !== 0) exitCode = 1;
      }
      if (!values["skip-rundgang"] && index === 0) {
        const result = await runNode(
          "rundgang",
          [
            join(here, "stage-rundgang.mjs"),
            "--base-url",
            publicUrl,
            "--world",
            worlds.large,
            "--out",
            values["rundgang-dir"] ?? join(outDir, "rundgang"),
          ],
          {},
          `${proxyName}-rundgang.log`,
        );
        entry.rundgang = {
          exit: result.code,
          seconds: result.seconds,
          file: `${proxyName}-rundgang.log`,
        };
        log(`${proxyName}: rundgang exit ${result.code}\n${result.output.trim()}`);
        if (result.code !== 0) exitCode = 1;
      }
    });
  }
} catch (error) {
  log(`FAILED: ${error.message}`);
  protocol.error = String(error.message);
  exitCode = 1;
} finally {
  cleanup();
  if (values["remove-image"]) docker("rmi", IMAGE);
  protocol.finishedAt = new Date().toISOString();
  protocol.exit = exitCode;
  writeFileSync(join(outDir, "protocol.json"), `${JSON.stringify(protocol, null, 2)}\n`);
  writeFileSync(join(outDir, "protocol.log"), `${logLines.join("\n")}\n`);
  log(`protocol in ${outDir}`);
}
process.exit(exitCode);
