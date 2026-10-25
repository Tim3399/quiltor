import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/*
 * Runs one of the linters for the files outside the code: zizmor and actionlint for the
 * workflows, hadolint for the Dockerfiles, shellcheck for the shell scripts.
 *
 *   node tools/dev/lint-tool.mjs <zizmor|actionlint|hadolint|shellcheck>
 *
 * All four are single binaries. The versions live in distribution/toolchains.json
 * (lintTools), and a tool that reports another version is refused rather than run: a
 * different release audits differently, and a green local run would then promise nothing
 * about CI.
 *
 * zizmor comes from PyPI (distribution/lint-tools.requirements.txt) and is part of
 * `npm run check`, so a missing zizmor is an error, like a missing ruff. Its wheel installs
 * only an executable and no Python module, which is why this does not go through
 * tools/dev/python.mjs: there is nothing to `import`. Instead it looks in the scripts
 * directory of the same interpreters python.mjs would try, then on PATH.
 *
 * actionlint, hadolint and shellcheck are standalone downloads. Without them this says so
 * and exits 0 -- CI installs them by version and checksum and runs them there. In CI a
 * missing binary is an error, so a broken install step cannot pass as a clean lint.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WINDOWS = process.platform === "win32";
const ARM = process.arch === "arm64";

const { lintTools } = JSON.parse(
  readFileSync(resolve(ROOT, "distribution/toolchains.json"), "utf8"),
);

/** The pinned version of a tool, whichever shape its toolchains.json entry has. */
export function pinnedVersion(name) {
  const entry = lintTools[name];
  return typeof entry === "string" ? entry : entry.version;
}

function releaseAsset(name, version) {
  const os = WINDOWS ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
  switch (name) {
    case "actionlint":
      return (
        `https://github.com/rhysd/actionlint/releases/download/v${version}/` +
        `actionlint_${version}_${os}_${ARM ? "arm64" : "amd64"}.${WINDOWS ? "zip" : "tar.gz"}`
      );
    case "hadolint": {
      const file = WINDOWS
        ? "windows-x86_64.exe"
        : `${os === "darwin" ? "macos" : "linux"}-${ARM ? "arm64" : "x86_64"}`;
      return `https://github.com/hadolint/hadolint/releases/download/v${version}/hadolint-${file}`;
    }
    case "shellcheck": {
      const file = WINDOWS
        ? `shellcheck-v${version}.zip`
        : `shellcheck-v${version}.${os}.${ARM ? "aarch64" : "x86_64"}.tar.xz`;
      return `https://github.com/koalaman/shellcheck/releases/download/v${version}/${file}`;
    }
    default:
      throw new Error(`no release asset for ${name}`);
  }
}

/** The line a person runs to get the pinned version of a tool. */
export function installHint(name) {
  const version = pinnedVersion(name);
  if (name === "zizmor") {
    const python = WINDOWS ? "py -3.12" : "python3.12";
    return (
      `${python} -m pip install --require-hashes --only-binary=:all: ` +
      "-r distribution/lint-tools.requirements.txt"
    );
  }
  const file = WINDOWS ? `${name}.exe` : name;
  // hadolint's release asset is the executable itself; the other two are archives.
  const step = name === "hadolint" ? `save it as ${file}` : `unpack ${file} from it`;
  return `download ${releaseAsset(name, version)}, ${step} and put it on PATH`;
}

const PYTHONS = WINDOWS
  ? [
      ["py", ["-3.12"]],
      ["python", []],
      ["python3", []],
    ]
  : [
      ["python3.12", []],
      ["python3", []],
      ["python", []],
    ];

// No shell, for the reason python.mjs gives: through cmd a `-c` snippet arrives split.
function pythonScriptDirs() {
  const snippet =
    "import sysconfig,os;print(sysconfig.get_path('scripts'));" +
    "print(sysconfig.get_path('scripts',os.name+'_user'))";
  const dirs = [];
  for (const [command, prefix] of PYTHONS) {
    const run = spawnSync(command, [...prefix, "-c", snippet], { encoding: "utf8" });
    if (run.status === 0) dirs.push(...run.stdout.split(/\r?\n/u).filter(Boolean));
  }
  return dirs;
}

function onPath(name, extraDirs = []) {
  const file = WINDOWS ? `${name}.exe` : name;
  const dirs = [...extraDirs, ...(process.env.PATH ?? "").split(delimiter)];
  return dirs.map((dir) => join(dir, file)).find((candidate) => existsSync(candidate));
}

const VERSION_FLAG = {
  zizmor: "--version",
  actionlint: "-version",
  hadolint: "--version",
  shellcheck: "--version",
};

/** Where a tool is and what it reports, or `{ missing: true }`. */
export function locate(name) {
  const path = onPath(name, name === "zizmor" ? pythonScriptDirs() : []);
  if (!path) return { missing: true, text: "not found" };
  const run = spawnSync(path, [VERSION_FLAG[name]], { encoding: "utf8" });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const found = output.match(/(\d+\.\d+\.\d+)/u)?.[1] ?? "unknown version";
  return { missing: false, path, text: found };
}

function trackedFiles(...patterns) {
  const run = spawnSync("git", ["ls-files", "-z", "--", ...patterns], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (run.status !== 0) throw new Error(`git ls-files failed: ${run.stderr}`);
  return run.stdout.split("\0").filter(Boolean);
}

/** The arguments each tool gets. Kept here so a local run and CI run the same command. */
function argumentsFor(name) {
  switch (name) {
    // --offline: the online audits need a GitHub token and would make a local run differ
    // from CI's. .github/zizmor.yml is found on its own.
    case "zizmor":
      return { args: ["--offline", "--no-progress", ".github/workflows"] };
    case "actionlint": {
      // actionlint passes each `run:` script to shellcheck. Without the pinned shellcheck it
      // still checks syntax and expressions, and says what it left out.
      const shellcheck = locate("shellcheck");
      const pinned = !shellcheck.missing && shellcheck.text === pinnedVersion("shellcheck");
      return {
        // -pyflakes= : no step uses `shell: python`; disabled so whatever pyflakes happens
        // to be installed cannot change the result.
        args: [`-shellcheck=${pinned ? shellcheck.path : ""}`, "-pyflakes="],
        note: pinned
          ? undefined
          : `shellcheck ${pinnedVersion("shellcheck")} not available, so actionlint skipped ` +
            "the run: scripts; CI checks them.",
      };
    }
    case "hadolint":
      return {
        args: [
          "--config",
          "distribution/containers/hadolint.yaml",
          ...trackedFiles("Dockerfile", "**/Dockerfile", "*.Dockerfile", "**/*.Dockerfile"),
        ],
      };
    case "shellcheck":
      return { args: trackedFiles("*.sh", "**/*.sh") };
    default:
      return undefined;
  }
}

function main(argv) {
  const [name] = argv;
  const setup = argumentsFor(name);
  if (!setup || argv.length !== 1) {
    console.error("usage: node tools/dev/lint-tool.mjs <zizmor|actionlint|hadolint|shellcheck>");
    return 2;
  }
  const expected = pinnedVersion(name);
  const found = locate(name);
  if (found.missing) {
    if (name !== "zizmor" && !process.env.CI) {
      console.log(`${name} not installed, runs in CI. To run it here: ${installHint(name)}`);
      return 0;
    }
    console.error(`${name} ${expected} is not installed. Install it with:\n  ${installHint(name)}`);
    return 1;
  }
  if (found.text !== expected) {
    console.error(
      `${name} at ${found.path} reports ${found.text}, but distribution/toolchains.json pins ` +
        `${expected}. Install the pinned version:\n  ${installHint(name)}`,
    );
    return 1;
  }
  if (setup.args.length === 0) {
    console.error(`${name}: no files to check`);
    return 1;
  }
  if (setup.note) console.log(setup.note);
  const run = spawnSync(found.path, setup.args, { cwd: ROOT, stdio: "inherit" });
  return run.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
