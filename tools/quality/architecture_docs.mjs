import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const architectureViewPaths = [
  "views/core-software.md",
  "views/client-runtime.md",
  "views/cross-feature-projections.md",
  "views/application-and-persistence.md",
  "views/assistant-and-inference.md",
  "views/hosts-and-distribution.md",
];

function read(root, path) {
  const file = resolve(root, path);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function count(source, needle) {
  return source.split(needle).length - 1;
}

function checkRelativeLinks(root, relativePath, source, violations) {
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, "");
    if (!rawTarget || rawTarget.startsWith("#") || /^[a-z][a-z\d+.-]*:/i.test(rawTarget)) {
      continue;
    }

    const pathPart = rawTarget.split("#", 1)[0];
    if (!pathPart) continue;
    const target = resolve(root, dirname(relativePath), decodeURIComponent(pathPart));
    if (!existsSync(target)) {
      violations.push(`${relativePath}: broken architecture link ${rawTarget}`);
      continue;
    }
    if (rawTarget.endsWith("/") && !statSync(target).isDirectory()) {
      violations.push(`${relativePath}: expected directory link ${rawTarget}`);
    }
  }
}

export function architectureDocViolations(architectureRoot) {
  const violations = [];
  const targetPath = "target-component-model.md";
  const planPath = "implementation-plan.md";
  const target = read(architectureRoot, targetPath);
  const plan = read(architectureRoot, planPath);

  if (!target) violations.push(`${targetPath}: missing target component model`);
  if (!plan) violations.push(`${planPath}: missing normative delivery plan`);

  if (
    target &&
    !target.includes("Status: **normative boundaries with proposed class-level reference views**")
  ) {
    violations.push(`${targetPath}: authority status is not explicit`);
  }
  if (plan && !plan.includes("Status: **normative delivery plan**")) {
    violations.push(`${planPath}: must be the normative delivery plan`);
  }

  for (const viewPath of architectureViewPaths) {
    const source = read(architectureRoot, viewPath);
    if (!source) {
      violations.push(`${viewPath}: missing architecture view`);
      continue;
    }
    if (!source.includes("Status: **proposed target view**")) {
      violations.push(`${viewPath}: class-level view must remain proposed`);
    }
    if (!source.includes("```mermaid")) {
      violations.push(`${viewPath}: architecture view has no Mermaid diagram`);
    }
    if (!/Current (?:code|implementation)/i.test(source)) {
      violations.push(`${viewPath}: architecture view has no current-to-target mapping`);
    }

    const registered = count(target, `(${viewPath})`);
    if (registered !== 1) {
      violations.push(
        `${targetPath}: ${viewPath} must appear exactly once in the reading order (found ${registered})`,
      );
    }
    checkRelativeLinks(architectureRoot, viewPath, source, violations);
  }

  for (const [path, source] of [
    [targetPath, target],
    [planPath, plan],
  ]) {
    if (source) checkRelativeLinks(architectureRoot, path, source, violations);
  }

  const core = read(architectureRoot, "views/core-software.md");
  if (core) {
    for (const retired of [
      "class CommandDispatcher",
      "class WorldProjectSnapshot",
      "+DocumentHandle background",
    ]) {
      if (core.includes(retired)) {
        violations.push(`views/core-software.md: retired assumption remains: ${retired}`);
      }
    }
    if (!core.includes("WorldAssetId")) {
      violations.push("views/core-software.md: MapDefinition must use WorldAssetId");
    }
    if (!/(?:WorldTransaction|CommitPlan)/.test(core)) {
      violations.push("views/core-software.md: scoped transaction/commit boundary is missing");
    }
  }

  const persistence = read(architectureRoot, "views/application-and-persistence.md");
  if (persistence) {
    for (const retired of ["class ApplicationFacade", "class DomainEventOutbox"]) {
      if (persistence.includes(retired)) {
        violations.push(
          `views/application-and-persistence.md: retired default remains: ${retired}`,
        );
      }
    }
    for (const required of ["WorldCommitRepository", "CommitPlan"]) {
      if (!persistence.includes(required)) {
        violations.push(
          `views/application-and-persistence.md: atomic commit model is missing ${required}`,
        );
      }
    }
  }

  const assistant = read(architectureRoot, "views/assistant-and-inference.md");
  if (assistant) {
    for (const required of [
      "AcceptAssistantProposalUseCase",
      "AuthorizationPolicy",
      "ProposalAcceptancePolicy",
    ]) {
      if (!assistant.includes(required)) {
        violations.push(`views/assistant-and-inference.md: acceptance path is missing ${required}`);
      }
    }
  }

  const projections = read(architectureRoot, "views/cross-feature-projections.md");
  if (
    projections &&
    !(projections.includes("DraftContext") && projections.includes("canonical Assistant context"))
  ) {
    violations.push(
      "views/cross-feature-projections.md: draft projections and canonical Assistant context are not separated",
    );
  }

  if (target.includes("move operation-by-operation")) {
    violations.push(`${targetPath}: retired Rust storage cutover remains normative`);
  }
  for (const [required, pattern] of [
    ["complete World Storage boundary", /complete World Storage boundary/],
    ["generic command/query bus", /generic command\/query bus/i],
    ["WorldAssetId", /WorldAssetId/],
  ]) {
    if (plan && !pattern.test(plan)) {
      violations.push(`${planPath}: required reviewed decision is missing: ${required}`);
    }
  }

  const adr3Path = "decisions/0003-portable-local-core.md";
  const adr6Path = "decisions/0006-portable-core-boundary-and-migration-gates.md";
  const adr3 = read(architectureRoot, adr3Path);
  const adr6 = read(architectureRoot, adr6Path);
  if (!adr3.includes("superseded by") || !adr3.includes("0006-portable-core")) {
    violations.push(`${adr3Path}: must point to its superseding ADR 0006`);
  }
  if (!adr6.includes("supersedes") || !adr6.includes("0003-portable-local-core")) {
    violations.push(`${adr6Path}: must point back to superseded ADR 0003`);
  }

  return violations;
}
