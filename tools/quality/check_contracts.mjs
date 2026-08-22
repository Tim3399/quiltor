import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const DRAFT = "https://json-schema.org/draft/2020-12/schema";
const CONTRACT_ID = "https://quiltor.app/contracts/";
const root = resolve(process.argv[2] ?? process.cwd());
const contractsRoot = resolve(root, "contracts");
const failures = [];
const documents = new Map();

function fail(location, message) {
  failures.push(`${location}: ${message}`);
}

function display(path) {
  return relative(root, path).split(sep).join("/");
}

function parseJson(path) {
  const absolute = resolve(path);
  if (documents.has(absolute)) return documents.get(absolute);
  const value = JSON.parse(readFileSync(absolute, "utf8"));
  documents.set(absolute, value);
  return value;
}

function contractPath(path, label) {
  if (typeof path !== "string" || !path || isAbsolute(path) || path.includes("\\")) {
    throw new Error(`${label} must be a non-empty POSIX relative path`);
  }
  const absolute = resolve(contractsRoot, path);
  const boundary = relative(contractsRoot, absolute);
  if (boundary.startsWith("..") || isAbsolute(boundary)) {
    throw new Error(`${label} leaves the contracts directory`);
  }
  if (!existsSync(absolute)) throw new Error(`${label} does not exist: ${path}`);
  return realpathSync(absolute);
}

function pointer(document, fragment) {
  if (!fragment || fragment === "#") return document;
  if (!fragment.startsWith("#/")) throw new Error(`unsupported JSON pointer ${fragment}`);
  return fragment
    .slice(2)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((value, key) => {
      if (value === null || typeof value !== "object" || !(key in value)) {
        throw new Error(`missing JSON pointer segment ${key}`);
      }
      return value[key];
    }, document);
}

function resolveReference(reference, sourcePath) {
  const [target, fragment = ""] = reference.split("#", 2);
  let targetPath = sourcePath;
  if (target) {
    if (target.startsWith(CONTRACT_ID)) {
      targetPath = contractPath(target.slice(CONTRACT_ID.length), "$ref");
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
      throw new Error(`remote $ref is not vendored: ${target}`);
    } else {
      const candidate = resolve(dirname(sourcePath), target);
      const boundary = relative(contractsRoot, candidate);
      if (boundary.startsWith("..") || isAbsolute(boundary) || !existsSync(candidate)) {
        throw new Error(`unresolved or out-of-tree $ref: ${reference}`);
      }
      targetPath = realpathSync(candidate);
    }
  }
  return {
    schema: pointer(parseJson(targetPath), fragment ? `#${fragment}` : ""),
    path: targetPath,
  };
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function typeMatches(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object")
    return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isSafeInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function validate(instance, schema, sourcePath, at = "$") {
  if (schema === true) return [];
  if (schema === false) return [`${at} is rejected by a false schema`];
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return [`${at} has an invalid schema node`];
  }

  if (schema.$ref) {
    try {
      const target = resolveReference(schema.$ref, sourcePath);
      return validate(instance, target.schema, target.path, at);
    } catch (error) {
      return [`${at}: ${error.message}`];
    }
  }

  const errors = [];
  if (schema.allOf) {
    for (const child of schema.allOf) errors.push(...validate(instance, child, sourcePath, at));
  }
  if (schema.anyOf) {
    const matches = schema.anyOf.filter(
      (child) => validate(instance, child, sourcePath, at).length === 0,
    );
    if (!matches.length) errors.push(`${at} matches no anyOf branch`);
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter(
      (child) => validate(instance, child, sourcePath, at).length === 0,
    );
    if (matches.length !== 1)
      errors.push(`${at} matches ${matches.length} oneOf branches, expected 1`);
  }
  if (schema.not && validate(instance, schema.not, sourcePath, at).length === 0) {
    errors.push(`${at} matches a forbidden schema`);
  }
  if (schema.if) {
    const branch =
      validate(instance, schema.if, sourcePath, at).length === 0 ? schema.then : schema.else;
    if (branch) errors.push(...validate(instance, branch, sourcePath, at));
  }

  if (schema.const !== undefined && !same(instance, schema.const)) {
    errors.push(`${at} must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((item) => same(instance, item))) {
    errors.push(`${at} is not one of ${schema.enum.map(JSON.stringify).join(", ")}`);
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeMatches(instance, type))) {
      errors.push(`${at} must have type ${types.join("|")}`);
      return errors;
    }
  }

  if (typeof instance === "string") {
    const codePointLength = [...instance].length;
    if (schema.minLength !== undefined && codePointLength < schema.minLength)
      errors.push(`${at} is too short`);
    if (schema.maxLength !== undefined && codePointLength > schema.maxLength)
      errors.push(`${at} is too long`);
    if (schema.pattern) {
      try {
        if (!new RegExp(schema.pattern, "u").test(instance))
          errors.push(`${at} does not match ${schema.pattern}`);
      } catch (error) {
        errors.push(`${at} uses invalid pattern ${schema.pattern}: ${error.message}`);
      }
    }
  }
  if (typeof instance === "number") {
    if (schema.minimum !== undefined && instance < schema.minimum)
      errors.push(`${at} is below minimum`);
    if (schema.maximum !== undefined && instance > schema.maximum)
      errors.push(`${at} is above maximum`);
    if (schema.exclusiveMinimum !== undefined && instance <= schema.exclusiveMinimum)
      errors.push(`${at} is not above exclusiveMinimum`);
    if (schema.exclusiveMaximum !== undefined && instance >= schema.exclusiveMaximum)
      errors.push(`${at} is not below exclusiveMaximum`);
  }
  if (Array.isArray(instance)) {
    if (schema.minItems !== undefined && instance.length < schema.minItems)
      errors.push(`${at} has too few items`);
    if (schema.maxItems !== undefined && instance.length > schema.maxItems)
      errors.push(`${at} has too many items`);
    if (schema.uniqueItems && new Set(instance.map(JSON.stringify)).size !== instance.length)
      errors.push(`${at} has duplicate items`);
    if (schema.items)
      instance.forEach((item, index) =>
        errors.push(...validate(item, schema.items, sourcePath, `${at}[${index}]`)),
      );
  }
  if (instance !== null && typeof instance === "object" && !Array.isArray(instance)) {
    const propertyCount = Object.keys(instance).length;
    if (schema.minProperties !== undefined && propertyCount < schema.minProperties)
      errors.push(`${at} has too few properties`);
    if (schema.maxProperties !== undefined && propertyCount > schema.maxProperties)
      errors.push(`${at} has too many properties`);
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(instance, key)) errors.push(`${at}.${key} is required`);
    }
    const properties = schema.properties ?? {};
    const patterns = [];
    for (const [pattern, child] of Object.entries(schema.patternProperties ?? {})) {
      try {
        patterns.push([new RegExp(pattern, "u"), child]);
      } catch (error) {
        errors.push(`${at} uses invalid property pattern ${pattern}: ${error.message}`);
      }
    }
    for (const [key, value] of Object.entries(instance)) {
      if (Object.hasOwn(properties, key)) {
        errors.push(...validate(value, properties[key], sourcePath, `${at}.${key}`));
      }
      const matchingPatterns = patterns.filter(([pattern]) => pattern.test(key));
      for (const [, child] of matchingPatterns) {
        errors.push(...validate(value, child, sourcePath, `${at}.${key}`));
      }
      if (
        !Object.hasOwn(properties, key) &&
        !matchingPatterns.length &&
        schema.additionalProperties === false
      ) {
        errors.push(`${at}.${key} is not allowed`);
      } else if (
        !Object.hasOwn(properties, key) &&
        !matchingPatterns.length &&
        schema.additionalProperties &&
        typeof schema.additionalProperties === "object"
      ) {
        errors.push(...validate(value, schema.additionalProperties, sourcePath, `${at}.${key}`));
      }
    }
  }
  return errors;
}

function inspectReferences(node, sourcePath, location = "$") {
  if (!node || typeof node !== "object") return;
  if (typeof node.$ref === "string") {
    try {
      resolveReference(node.$ref, sourcePath);
    } catch (error) {
      fail(`${display(sourcePath)}${location}`, error.message);
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (key !== "$ref") inspectReferences(value, sourcePath, `${location}/${key}`);
  }
}

function inspectVersionConstants(node, found = []) {
  if (!node || typeof node !== "object") return found;
  if (node.properties?.version && Object.hasOwn(node.properties.version, "const")) {
    found.push(node.properties.version.const);
  }
  for (const value of Object.values(node)) inspectVersionConstants(value, found);
  return found;
}

function checkTsv(path) {
  const lines = readFileSync(path, "utf8").trim().split(/\r?\n/);
  if (lines[0] !== "id\ttime\tposition\texpected_index") return ["unexpected header"];
  const rows = lines.slice(1).map((line) => line.split("\t"));
  const errors = [];
  if (!rows.length) errors.push("fixture has no rows");
  if (rows.some((row) => row.length !== 4 || row.slice(1).some((value) => !/^-?\d+$/.test(value))))
    errors.push("every row needs an id and three integers");
  if (new Set(rows.map((row) => row[0])).size !== rows.length) errors.push("ids must be unique");
  const indexes = rows.map((row) => Number(row[3])).sort((a, b) => a - b);
  if (indexes.some((value, index) => value !== index))
    errors.push("expected_index must be contiguous from zero");
  return errors;
}

try {
  const manifestPath = contractPath("manifest.json", "manifest");
  const manifestSchemaPath = contractPath("manifest.schema.json", "manifest schema");
  const manifest = parseJson(manifestPath);
  const differentialSchemaPath = contractPath(
    "application-api/document-differential/v1.schema.json",
    "document differential schema",
  );
  const differentialSchema = parseJson(differentialSchemaPath);
  const aliasRulesPath = contractPath(
    "application-api/story-world/alias-normalization.v1.json",
    "story-world alias normalization rules",
  );
  const aliasRules = parseJson(aliasRulesPath);
  if (
    aliasRules.algorithm !== "quiltor.story-world.alias-ascii-v1" ||
    aliasRules.version !== 1 ||
    !same(aliasRules.asciiUppercase, { minimum: 65, maximum: 90, lowercaseOffset: 32 }) ||
    !same(aliasRules.separatorRanges, [
      { minimum: 0, maximum: 47 },
      { minimum: 58, maximum: 64 },
      { minimum: 91, maximum: 94 },
      { minimum: 96, maximum: 96 },
      { minimum: 123, maximum: 127 },
    ]) ||
    aliasRules.nonAscii !== "Preserve every code point without normalization or case folding"
  ) {
    fail(
      display(aliasRulesPath),
      "alias-ascii-v1 is frozen; incompatible rule changes require a new version",
    );
  }
  const manifestErrors = validate(manifest, parseJson(manifestSchemaPath), manifestSchemaPath);
  manifestErrors.forEach((error) => fail(display(manifestPath), error));

  const identities = new Set();
  const fixturePaths = new Set();
  for (const contract of manifest.contracts ?? []) {
    const label = `${contract.name}@v${contract.version}`;
    const identity = `${contract.name}:${contract.version}`;
    if (identities.has(identity)) fail(label, "duplicate contract identity");
    identities.add(identity);

    let schemaPath;
    let schema;
    if (contract.schema !== null) {
      try {
        schemaPath = contractPath(contract.schema, `${label} schema`);
        schema = parseJson(schemaPath);
        const expectedId = `${CONTRACT_ID}${contract.schema}`;
        if (schema.$schema !== DRAFT) fail(display(schemaPath), `must use ${DRAFT}`);
        if (schema.$id !== expectedId) fail(display(schemaPath), `$id must be ${expectedId}`);
        if (
          !contract.schema.endsWith(`/v${contract.version}.schema.json`) &&
          contract.schema !== `v${contract.version}.schema.json`
        ) {
          fail(label, "schema filename does not match contract version");
        }
        for (const version of inspectVersionConstants(schema)) {
          if (version !== contract.version)
            fail(
              display(schemaPath),
              `version const ${version} differs from manifest v${contract.version}`,
            );
        }
        inspectReferences(schema, schemaPath);
      } catch (error) {
        fail(label, error.message);
      }
    }

    if (contract.reference) {
      try {
        contractPath(contract.reference, `${label} reference`);
      } catch (error) {
        fail(label, error.message);
      }
    }
    for (const fixture of contract.fixtures ?? []) {
      if (fixturePaths.has(fixture.path)) fail(label, `fixture registered twice: ${fixture.path}`);
      fixturePaths.add(fixture.path);
      try {
        const fixturePath = contractPath(fixture.path, `${label} fixture`);
        if (fixture.mediaType === "application/json") {
          const value = parseJson(fixturePath);
          if (fixture.role === "differential") {
            validate(value, differentialSchema, differentialSchemaPath).forEach((error) =>
              fail(display(fixturePath), error),
            );
            if (value.contract !== contract.name || value.version !== contract.version) {
              fail(display(fixturePath), "differential corpus identity differs from its contract");
            }
            try {
              contractPath(value.baseFixture, `${label} differential baseFixture`);
              if (
                !(contract.fixtures ?? []).some(
                  (candidate) =>
                    candidate.path === value.baseFixture && candidate.role !== "differential",
                )
              ) {
                fail(
                  display(fixturePath),
                  "differential baseFixture must be registered on the same contract",
                );
              }
            } catch (error) {
              fail(display(fixturePath), error.message);
            }
            const caseIds = [
              ...(value.optionalPresence ?? []).map((item) => item.id),
              ...(value.cases ?? []).map((item) => item.id),
            ];
            if (new Set(caseIds).size !== caseIds.length) {
              fail(display(fixturePath), "differential case ids must be unique");
            }
          } else if (!schema) fail(label, "JSON fixture has no schema");
          else
            validate(value, schema, schemaPath).forEach((error) =>
              fail(display(fixturePath), error),
            );
          if (contract.name === "host.mcp-tools") {
            const names = new Set();
            for (const tool of value.tools ?? []) {
              if (names.has(tool.name))
                fail(display(fixturePath), `duplicate MCP tool ${tool.name}`);
              names.add(tool.name);
              validate(
                tool.example,
                tool.inputSchema,
                fixturePath,
                `$.tools.${tool.name}.example`,
              ).forEach((error) => fail(display(fixturePath), error));
            }
          }
          if (contract.name === "persistence.sqlite-migrations") {
            let expected = value.baselineSchemaVersion;
            for (const step of value.steps ?? []) {
              if (step.from !== expected || step.to !== expected + 1)
                fail(display(fixturePath), "migration steps must form a contiguous chain");
              expected = step.to;
            }
            if (expected !== value.currentSchemaVersion)
              fail(display(fixturePath), "currentSchemaVersion does not match the chain tip");
          }
        } else {
          checkTsv(fixturePath).forEach((error) => fail(display(fixturePath), error));
        }
      } catch (error) {
        fail(label, error.message);
      }
    }
    if (
      ["application.manuscript-wire", "application.story-world-wire"].includes(contract.name) &&
      !(contract.fixtures ?? []).some((fixture) => fixture.role === "differential")
    ) {
      fail(label, "document wire contract must register a differential corpus");
    }
  }
} catch (error) {
  fail("contracts", error.stack ?? error.message);
}

if (failures.length) {
  console.error(`Contract registry violations (${failures.length}):\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("Contract registry, schemas, references, and fixtures are consistent.");
}
