import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { designIndexViolations } from "./css_ownership.mjs";
import {
  closeFrontendBoundaryParser,
  frontendImportViolations,
  frontendSourceExtensions,
  importedSpecifiers,
} from "./frontend_boundaries.mjs";
import { rustSafetyViolations } from "./rust_safety.mjs";

const root = process.cwd();
const violations = [];

function report(file, message) {
  violations.push(`${relative(root, file)}: ${message}`);
}

function filesBelow(directory, extensions) {
  if (!existsSync(directory)) return [];
  const files = [];

  function visit(path) {
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path)) visit(join(path, name));
      return;
    }
    if (extensions.has(extname(path))) files.push(path);
  }

  visit(directory);
  return files;
}

const required = [
  "apps",
  "apps/README.md",
  "contracts",
  "crates/quiltor-core",
  "distribution",
  "docs/architecture",
  "locales",
  "packages/client/src",
  "src/quiltor",
  "src/quiltor/resources/sidecars",
  "tools/README.md",
];

for (const path of required) {
  if (!existsSync(resolve(root, path))) {
    violations.push(`${path}: required architecture root is missing`);
  }
}

const removedLegacyRoots = [
  "backend",
  "hosts",
  "packaging",
  "formatting",
  "scripts",
  "src/language",
];
for (const path of removedLegacyRoots) {
  if (existsSync(resolve(root, path))) {
    violations.push(`${path}: legacy root must be removed after the cutover`);
  }
}

for (const file of filesBelow(resolve(root, "crates"), new Set([".rs"]))) {
  const relativePath = relative(root, file).replaceAll("\\", "/");
  for (const message of rustSafetyViolations(relativePath, readFileSync(file, "utf8"))) {
    report(file, message);
  }
}

const clientRoot = resolve(root, "packages/client/src");
const modulesRoot = resolve(clientRoot, "modules");
const designRoot = resolve(clientRoot, "design");
const appsRoot = resolve(root, "apps");
const webHostRoot = resolve(appsRoot, "web");
const clientPlatform = `${sep}platform${sep}`;
const clientHttp = `${sep}platform${sep}http${sep}`;
const clientApplicationPorts = `${sep}platform${sep}application${sep}`;
const clientWireContracts = `${sep}platform${sep}contracts${sep}`;
const retiredClientRoots = ["features", "hooks", "lib"];
const retiredClientFiles = ["types.ts", "App.tsx", "styles.css"];
const retiredClientModules = ["workspace-tools"];
const retiredClientCollectors = [
  "app/contracts",
  "app/hooks",
  "hosts",
  "platform/ApplicationGateway.ts",
  "platform/http/QuiltorHttpClient.ts",
];
const frontendCodeExtensions = new Set(frontendSourceExtensions);

// Global reset/tokens/materials and the deliberately tiny semantic typography utilities are the
// only root-level design authorities. Product chrome and feature rules must live beside their
// owner; otherwise a harmless-looking `app.css` becomes the next 3,000-line application collector.
const allowedDesignRootStyles = new Set([
  "base.css",
  "colors.css",
  "index.css",
  "materials.css",
  "motion.css",
  "tokens.css",
  "typography.css",
]);
if (existsSync(designRoot)) {
  for (const name of readdirSync(designRoot)) {
    const path = resolve(designRoot, name);
    if (statSync(path).isFile() && extname(path) === ".css" && !allowedDesignRootStyles.has(name)) {
      report(
        path,
        "global application stylesheet collectors are retired; assign rules to an owner",
      );
    }
  }
}
const designIndex = resolve(designRoot, "index.css");
if (existsSync(designIndex)) {
  for (const message of designIndexViolations(readFileSync(designIndex, "utf8"))) {
    report(designIndex, message);
  }
}

const frontendStyleFiles = filesBelow(clientRoot, new Set([".css"]));
for (const file of frontendStyleFiles) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/).length;
  if (lines > 450) {
    report(file, `${lines} lines recreates a global or feature stylesheet monolith`);
  }
}

const styleRuleOwners = new Map();
for (const file of frontendStyleFiles) {
  const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim().replace(/\s+/g, " ");
    const body = match[2].trim().replace(/\s+/g, " ");
    if (!selector || !body || selector.startsWith("@") || /^(?:from|to|\d+%)$/.test(selector)) {
      continue;
    }
    const definition = `${selector}{${body}}`;
    const owner = styleRuleOwners.get(definition);
    if (owner && owner !== file) {
      report(
        file,
        `duplicates the complete ${selector} rule owned by ${relative(root, owner)}; keep one CSS owner`,
      );
    } else {
      styleRuleOwners.set(definition, file);
    }
  }
}

const frontendCodeFiles = filesBelow(clientRoot, frontendCodeExtensions);
const ownedStyleImports = new Map();
for (const file of frontendCodeFiles) {
  for (const specifier of importedSpecifiers(file, readFileSync(file, "utf8"))) {
    if (!specifier.endsWith(".css") || !specifier.startsWith(".")) continue;
    const target = resolve(file, "..", specifier);
    const importers = ownedStyleImports.get(target) || [];
    importers.push(file);
    ownedStyleImports.set(target, importers);
  }
}
for (const file of frontendStyleFiles) {
  if (file.startsWith(`${designRoot}${sep}`)) continue;
  if (!ownedStyleImports.has(file)) {
    report(file, "owner stylesheet is orphaned; import it explicitly from its component or module");
  }
}

for (const path of retiredClientRoots) {
  if (existsSync(resolve(clientRoot, path))) {
    violations.push(`packages/client/src/${path}: technical collection root must be removed`);
  }
}
for (const path of retiredClientFiles) {
  if (existsSync(resolve(clientRoot, path))) {
    violations.push(`packages/client/src/${path}: legacy frontend facade must be removed`);
  }
}
for (const path of retiredClientModules) {
  if (existsSync(resolve(modulesRoot, path))) {
    violations.push(
      `packages/client/src/modules/${path}: cross-domain collection module must be removed`,
    );
  }
}
for (const path of retiredClientCollectors) {
  if (existsSync(resolve(clientRoot, path))) {
    violations.push(`packages/client/src/${path}: retired cross-domain collector must be removed`);
  }
}

const appRoot = resolve(clientRoot, "app");
for (const path of ["overlays", "shell", "shortcuts", "workspace", "world"]) {
  if (!existsSync(resolve(appRoot, path))) {
    violations.push(`packages/client/src/app/${path}: required application owner is missing`);
  }
}
const allowedAppRootFiles = new Set(["Application.tsx", "AppShell.tsx", "AppShell.test.tsx"]);
if (existsSync(appRoot)) {
  for (const name of readdirSync(appRoot)) {
    const path = resolve(appRoot, name);
    if (
      statSync(path).isFile() &&
      frontendCodeExtensions.has(extname(path)) &&
      !allowedAppRootFiles.has(name)
    ) {
      report(path, "app root is composition-only; assign the file to a named application owner");
    }
  }
}

for (const path of [
  "platform/application/metadata.ts",
  "platform/application/worlds.ts",
  "platform/application/identity.ts",
  "platform/application/storyWorld.ts",
  "platform/application/manuscript.ts",
  "platform/application/backup.ts",
  "platform/application/history.ts",
  "platform/application/assistant.ts",
  "platform/application/writingAssistance.ts",
  "platform/application/documents.ts",
  "platform/application/errors.ts",
  "platform/http/index.ts",
  "platform/http/createHttpApplicationGateway.ts",
  "platform/http/request.ts",
  "platform/http/documentTransport.ts",
  "platform/http/assistantJobs.ts",
]) {
  if (!existsSync(resolve(clientRoot, path))) {
    violations.push(`packages/client/src/${path}: required frontend boundary is missing`);
  }
}
const webBootstrap = resolve(root, "apps/web/main.tsx");
if (!existsSync(webBootstrap)) {
  violations.push("apps/web/main.tsx: required executable web composition root is missing");
} else {
  const bootstrapText = readFileSync(webBootstrap, "utf8");
  for (const binding of [
    "createHttpApplicationGateway",
    "createPlatformGateway",
    "configureQuiltorClient",
  ]) {
    if (!bootstrapText.includes(binding))
      report(webBootstrap, `web composition is missing ${binding}`);
  }
  for (const specifier of importedSpecifiers(webBootstrap, bootstrapText)) {
    if (
      specifier.includes("packages/client/src/design/") &&
      !specifier.endsWith("/design/index.css")
    ) {
      report(webBootstrap, "the web host may import only the public design/index.css authority");
    }
  }
}
const publicPlatformIndex = resolve(clientRoot, "platform/index.ts");
if (existsSync(publicPlatformIndex)) {
  const platformIndexText = readFileSync(publicPlatformIndex, "utf8");
  if (
    platformIndexText.includes("createHttpApplicationGateway") ||
    importedSpecifiers(publicPlatformIndex, platformIndexText).some((item) =>
      item.includes("/http"),
    )
  ) {
    report(
      publicPlatformIndex,
      "concrete HTTP factories must not be exported by the public platform API",
    );
  }
}

if (existsSync(modulesRoot)) {
  for (const name of readdirSync(modulesRoot)) {
    const moduleRoot = resolve(modulesRoot, name);
    if (statSync(moduleRoot).isDirectory() && !existsSync(resolve(moduleRoot, "index.ts"))) {
      report(moduleRoot, "module must expose an explicit public index.ts API");
    }
  }
}
const browserOnly = [
  ["window.pywebview", "native bridge access"],
  ["window.open(", "external navigation"],
  ["navigator.clipboard", "clipboard access"],
  ["localStorage", "settings storage"],
];

for (const file of filesBelow(clientRoot, frontendCodeExtensions)) {
  const text = readFileSync(file, "utf8");
  const isTest = file.endsWith(".test.ts") || file.endsWith(".test.tsx");
  const isPlatformAdapter =
    file.includes(clientPlatform) ||
    file.includes(`${sep}i18n${sep}`) ||
    file.includes(`${sep}test${sep}`);

  if (!isPlatformAdapter && !isTest) {
    for (const [needle, capability] of browserOnly) {
      if (text.includes(needle)) report(file, `${capability} must use PlatformGateway`);
    }
  }
  if (!file.includes(clientHttp) && /\bfetch\s*\(/.test(text)) {
    report(file, "fetch is confined to a registered HTTP ApplicationGateway adapter");
  }
  if (
    file.includes(clientApplicationPorts) &&
    /\b(?:httpStatus|fetch|Request|Response)\b/.test(text)
  ) {
    report(file, "application ports must remain transport-neutral");
  }
  if (
    !file.includes(clientHttp) &&
    !file.includes(clientWireContracts) &&
    /\b(?:LanguageStatus|LanguageLookupResult|languageStatus|languageLookup|installLanguageData)\b/.test(
      text,
    )
  ) {
    report(file, "product code must use WritingAssistance naming");
  }
  if (text.includes("/api/language")) {
    report(file, "retired language routes must use /api/writing-assistance");
  }

  for (const message of frontendImportViolations({
    file,
    source: text,
    clientRoot,
    modulesRoot,
    webHostRoot,
  })) {
    report(file, message);
  }
}

for (const file of filesBelow(appsRoot, frontendCodeExtensions)) {
  const text = readFileSync(file, "utf8");
  for (const message of frontendImportViolations({
    file,
    source: text,
    clientRoot,
    modulesRoot,
    webHostRoot,
  })) {
    report(file, message);
  }
}

const pythonRoot = resolve(root, "src/quiltor");
const applicationRoot = resolve(pythonRoot, "application");
for (const path of [
  "src/quiltor/application/capabilities.py",
  "src/quiltor/application/observability.py",
  "src/quiltor/application/worlds/ports.py",
  "src/quiltor/application/worlds/use_cases.py",
  "src/quiltor/application/documents/ports.py",
  "src/quiltor/application/documents/use_cases.py",
  "src/quiltor/application/backups/ports.py",
  "src/quiltor/application/backups/use_cases.py",
  "src/quiltor/application/assistant/use_cases.py",
  "src/quiltor/application/story_world/use_cases.py",
  "src/quiltor/bootstrap/application.py",
  "src/quiltor/modules/assistant/ports.py",
  "src/quiltor/modules/assistant/prompts.py",
  "src/quiltor/modules/assistant/conversation.py",
  "src/quiltor/modules/assistant/completion.py",
  "src/quiltor/modules/assistant/planner.py",
  "src/quiltor/modules/assistant/proposals.py",
  "src/quiltor/modules/assistant/runtime.py",
  "src/quiltor/modules/identity/ports.py",
  "src/quiltor/modules/writing_assistance/ports.py",
  "src/quiltor/infrastructure/inference/installation.py",
  "src/quiltor/infrastructure/observability/stdlib.py",
  "src/quiltor/infrastructure/persistence/assistant_jobs.py",
  "src/quiltor/infrastructure/persistence/adapters/worlds.py",
  "src/quiltor/infrastructure/persistence/adapters/documents.py",
  "src/quiltor/infrastructure/persistence/adapters/backups.py",
  "src/quiltor/infrastructure/persistence/sqlite/config.py",
  "src/quiltor/infrastructure/persistence/sqlite/connection.py",
  "src/quiltor/infrastructure/persistence/sqlite/manuscript.py",
  "src/quiltor/infrastructure/persistence/sqlite/migrations.py",
  "src/quiltor/infrastructure/persistence/sqlite/restore.py",
  "src/quiltor/infrastructure/persistence/sqlite/revisions.py",
  "src/quiltor/infrastructure/persistence/sqlite/schema.py",
  "src/quiltor/infrastructure/persistence/sqlite/story_world.py",
  "src/quiltor/infrastructure/persistence/sqlite/world_catalog.py",
]) {
  if (!existsSync(resolve(root, path))) {
    violations.push(`${path}: required application boundary is missing`);
  }
}

const retiredStorageMonolith = resolve(root, "src/quiltor/infrastructure/persistence/storage.py");
if (existsSync(retiredStorageMonolith)) {
  report(retiredStorageMonolith, "SQLite persistence must stay split by aggregate");
}
const retiredRepositoryCollector = resolve(
  root,
  "src/quiltor/infrastructure/persistence/repositories.py",
);
if (existsSync(retiredRepositoryCollector)) {
  report(
    retiredRepositoryCollector,
    "persistence repositories must stay split by application context",
  );
}
for (const file of filesBelow(
  resolve(root, "src/quiltor/infrastructure/persistence/sqlite"),
  new Set([".py"]),
)) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/).length;
  if (lines > 600) {
    report(file, `${lines} lines recreates a persistence monolith`);
  }
}
const applicationFiles = filesBelow(applicationRoot, new Set([".py"]));
if (applicationFiles.length < 5) {
  violations.push("src/quiltor/application: use-case boundary is missing or vacuous");
}

const assistantRuntime = resolve(root, "src/quiltor/modules/assistant/runtime.py");
if (existsSync(assistantRuntime)) {
  const lines = readFileSync(assistantRuntime, "utf8").split(/\r?\n/).length;
  if (lines > 220) {
    report(assistantRuntime, `${lines} lines recreates the assistant policy/pipeline monolith`);
  }
}

for (const file of filesBelow(pythonRoot, new Set([".py"]))) {
  const text = readFileSync(file, "utf8");
  const normalized = file.split(sep).join("/");
  const inPlatform = normalized.includes("/infrastructure/platform/");
  const inHost = normalized.includes("/hosts/") || normalized.includes("/delivery/");
  const inBootstrap = normalized.includes("/bootstrap/");

  if (!inPlatform && !inHost && !inBootstrap) {
    for (const needle of ["sys.platform", "platform.system(", "os.name", "Path.home("]) {
      if (text.includes(needle)) report(file, `${needle} belongs in a platform adapter`);
    }
  }

  if (normalized.includes("/domain/")) {
    for (const dependency of ["infrastructure", "delivery", "bootstrap", "sqlite3", "subprocess"]) {
      if (text.includes(dependency)) report(file, `domain must not depend on ${dependency}`);
    }
  }

  if (normalized.includes("/application/")) {
    for (const dependency of ["infrastructure", "delivery", "hosts", "bootstrap"]) {
      const importPattern = new RegExp(`(?:from|import)\\s+quiltor\\.${dependency}\\b`);
      if (importPattern.test(text)) {
        report(file, `application must not depend on ${dependency}`);
      }
    }
    for (const dependency of ["sqlite3", "http.server"]) {
      const importPattern = new RegExp(
        `(?:^|\\n)\\s*(?:from\\s+${dependency.replace(".", "\\.")}\\b|import\\s+${dependency.replace(".", "\\.")}\\b)`,
      );
      if (importPattern.test(text)) report(file, `application must not depend on ${dependency}`);
    }
  }

  if (normalized.includes("/modules/")) {
    const importPattern = /(?:from|import)\s+quiltor\.infrastructure\b/;
    if (importPattern.test(text)) {
      report(file, "product modules must consume injected ports, not concrete infrastructure");
    }
  }

  if (
    normalized.endsWith("/modules/identity/service.py") &&
    /(?:\brender_token_store\b|storage\.LOCAL_OWNER|\bRENDER_TOKEN_TTL\b)/.test(text)
  ) {
    report(file, "identity owner and render-token storage must be injected ports");
  }

  if (
    normalized.includes("/modules/identity/") &&
    /(?:^|\n)\s*(?:from\s+(?:os|ssl|urllib\.(?:request|error))\b|import\s+(?:os|ssl|urllib\.(?:request|error))\b)|\bos\.environ\b/.test(
      text,
    )
  ) {
    report(
      file,
      "identity modules must receive operating-system and network services through ports",
    );
  }

  if (
    normalized.includes("/modules/assistant/") &&
    /(?:^|\n)\s*(?:from\s+(?:sqlite3|os)\b|import\s+(?:sqlite3|os)\b)|\bos\.environ\b/.test(text)
  ) {
    report(
      file,
      "assistant modules must receive persistence and runtime configuration through ports",
    );
  }

  if (
    normalized.endsWith("/modules/assistant/jobs.py") &&
    /(?:^|\n)\s*(?:from\s+sqlite3|import\s+sqlite3)|class\s+AssistantJobStore\b/.test(text)
  ) {
    report(file, "assistant job persistence belongs in an infrastructure adapter");
  }

  const isHttpRoute = normalized.includes("/delivery/http/routes/");
  const isMcpHost = normalized.includes("/hosts/mcp/");
  if (isHttpRoute && /(?:from|import)\s+quiltor\.infrastructure\b/.test(text)) {
    report(file, "HTTP delivery must consume injected application or product ports");
  }
  if (isHttpRoute && /\bapp\.application\b/.test(text)) {
    report(file, "HTTP routes must receive only their context-specific service slice");
  }
  if (
    (isHttpRoute || isMcpHost) &&
    /(?:from|import)\s+quiltor\.infrastructure\.persistence\b/.test(text)
  ) {
    report(file, "delivery must use injected context-specific application use cases");
  }

  if (
    normalized.endsWith("/delivery/http/routes/backup.py") &&
    (/(?:from|import)\s+quiltor\.infrastructure\b/.test(text) || /WORLD_BACKUPS/.test(text))
  ) {
    report(file, "backup HTTP must use the injected backup application slice only");
  }

  if (normalized.endsWith("/hosts/web/server.py") && /\bWORLD_BACKUPS\b/.test(text)) {
    report(file, "world backup operations must be composed behind BackupUseCases");
  }

  if (
    normalized.endsWith("/hosts/web/server.py") &&
    /^(?:IDENTITY|OPERATIONS|ASSISTANT|ASSISTANT_JOBS|WRITING_ASSISTANCE|BACKUP_AUTHORIZER|FEATURE_AVAILABILITY|OBSERVABILITY)\s*=/m.test(
      text,
    )
  ) {
    report(file, "web product state must belong to an injected WebApplication instance");
  }

  if (/\bLanguageService\b|\bLANGUAGE\s*=/.test(text)) {
    report(file, "backend writing-assistance concepts must not use the retired Language name");
  }

  if (text.includes("/api/language")) {
    report(file, "retired language routes must use /api/writing-assistance");
  }

  if (
    normalized.endsWith("/delivery/http/routes/assistant.py") &&
    text.includes("/api/assistant/chat")
  ) {
    report(file, "the retired synchronous assistant endpoint must not bypass the durable job API");
  }

  if (normalized.endsWith("/hosts/cli/main.py") && /_install_language_step\b/.test(text)) {
    report(file, "CLI setup must use the WritingAssistance name internally");
  }
}

for (const file of filesBelow(resolve(root, "tools/evaluation"), new Set([".py", ".mjs"]))) {
  const text = readFileSync(file, "utf8");
  if (text.includes("/api/assistant/chat")) {
    report(file, "developer tooling must use the durable assistant job API");
  }
}

const resourceResolver = resolve(root, "src/quiltor/resources.py");
if (existsSync(resourceResolver)) {
  const text = readFileSync(resourceResolver, "utf8");
  for (const retired of ["runtime_script", "RUNTIME_SCRIPTS", "resources/scripts"]) {
    if (text.includes(retired)) {
      report(resourceResolver, `retired generic runtime-script ownership remains: ${retired}`);
    }
  }
}

for (const legacy of [
  "src/quiltor/application/operations.py",
  "src/quiltor/application/models.py",
  "src/quiltor/application/ports/backups.py",
  "src/quiltor/application/ports/documents.py",
  "src/quiltor/application/ports/worlds.py",
  "src/quiltor/application/ports/observability.py",
]) {
  if (existsSync(resolve(root, legacy))) {
    violations.push(`${legacy}: generic application collector must remain split by context`);
  }
}

for (const required of [
  "src/quiltor/application/worlds/use_cases.py",
  "src/quiltor/application/documents/use_cases.py",
  "src/quiltor/application/backups/use_cases.py",
  "src/quiltor/application/assistant/use_cases.py",
  "src/quiltor/application/story_world/use_cases.py",
]) {
  if (!existsSync(resolve(root, required))) {
    violations.push(`${required}: missing context-owned application boundary`);
  }
}

for (const legacy of [
  "src/quiltor/modules/writing_assistance/storage.py",
  "src/quiltor/modules/writing_assistance/installer.py",
  "src/quiltor/modules/writing_assistance/grammar/languagetool.py",
]) {
  if (existsSync(resolve(root, legacy))) {
    violations.push(`${legacy}: concrete writing-assistance adapter belongs in infrastructure`);
  }
}

for (const legacy of [
  "src/quiltor/delivery/http/routes/language.py",
  "tests/python/test_language.py",
  "tests/python/test_cli_language_install.py",
]) {
  if (existsSync(resolve(root, legacy))) {
    violations.push(`${legacy}: retired Language naming is forbidden after the cutover`);
  }
}

for (const legacy of ["src/quiltor/infrastructure/pdf/contract.py"]) {
  if (existsSync(resolve(root, legacy))) {
    violations.push(`${legacy}: deprecated compatibility facades are forbidden after the cutover`);
  }
}

const contractTests = resolve(root, "tests/python/test_architecture_contracts.py");
if (existsSync(contractTests)) {
  const text = readFileSync(contractTests, "utf8");
  for (const binding of ["FORMAT_VERSION", "SCHEMA_VERSION", "tools.v1.json"]) {
    if (!text.includes(binding)) {
      report(contractTests, `runtime contract drift check is missing ${binding}`);
    }
  }
}

closeFrontendBoundaryParser();

if (violations.length) {
  console.error(`Architecture violations (${violations.length}):\n${violations.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("Architecture boundaries are clean.");
}
