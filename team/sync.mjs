#!/usr/bin/env node
// Erzeugt aus team/roles/*.md das Team für Claude Code (und optional Codex).
//
// Jede Rolle ist ein eigener Chat (Output-Style), ein Subagent oder beides:
//   kind: chat              -> .claude/output-styles/<chat.style>.md
//   kind: subagent          -> .claude/agents/<name>.md
//   kind: chat+subagent     -> beides
// Dazu kommen team/roles.json (für Hooks und Teamaufbau) und die Team-Einträge in .claude/settings.json.
//
//   node team/sync.mjs          generieren
//   node team/sync.mjs --check  nur prüfen, ob alles aktuell ist
//
// Quelle der Wahrheit: team/roles/*.md, team/roles/_chat-basis.md und team/team.config.json.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEAM_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(TEAM_DIR);
const MARKER = "generiert von team/sync.mjs – nicht direkt bearbeiten, Quelle: team/roles/";
const HOOK_MARK = "team/hooks/";
// zerlegt, damit `agent-team init` ihn beim Kopieren der Vorlage nicht ersetzt
const KB_PLACEHOLDER = "<KB_" + "ROOT>";

const args = new Set(process.argv.slice(2));
const config = JSON.parse(fs.readFileSync(path.join(TEAM_DIR, "team.config.json"), "utf8"));
const targets = config.targets ?? ["claude"];
const checkOnly = args.has("--check");
const testCommand = (config.project?.testCommand ?? "").trim();

// Testbefehl aus dem letzten Lauf (steht in roles.json), um dessen Freigabe wieder zu entfernen
function previousTestCommand() {
  const file = path.join(TEAM_DIR, "roles.json");
  if (!fs.existsSync(file)) return "";
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")).testCommand ?? "";
  } catch {
    return "";
  }
}

// ---------- Rollen lesen ----------

function parseRole(file) {
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${file}: Kopfbereich (--- … ---) fehlt`);
  const head = {};
  for (const line of m[1].split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const i = line.indexOf(":");
    if (i < 0) throw new Error(`${file}: Zeile ohne ":" im Kopf: ${line}`);
    head[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  for (const key of ["name", "kind", "targets", "description"]) {
    if (!head[key]) throw new Error(`${file}: Pflichtfeld "${key}" fehlt`);
  }
  const forms = head.kind.split("+").map((s) => s.trim());
  for (const f of forms)
    if (!["chat", "subagent"].includes(f)) throw new Error(`${file}: unbekannte kind "${f}"`);
  if (forms.includes("chat") && (!head["chat.style"] || !head["chat.title"])) {
    throw new Error(`${file}: Chat-Rollen brauchen chat.style und chat.title`);
  }
  return { file, head, body: m[2], forms, targets: head.targets.split(",").map((s) => s.trim()) };
}

// Blöcke <!-- nur: claude --> … <!-- /nur -->. Bedingungen mit + verknüpft:
// Ziel (claude, codex) und Form (chat, subagent). Ein Block gilt, wenn alle Bedingungen zutreffen.
function filterBody(body, target, form) {
  const out = [];
  let keep = true;
  let open = false;
  for (const line of body.split("\n")) {
    const start = line.match(/^\s*<!--\s*nur:\s*([a-z+\s]+?)\s*-->\s*$/);
    if (start) {
      if (open) throw new Error("Verschachtelte <!-- nur --> Blöcke werden nicht unterstützt");
      const conds = start[1].split("+").map((s) => s.trim());
      for (const c of conds) {
        if (!["claude", "codex", "chat", "subagent"].includes(c))
          throw new Error(`Unbekannte Bedingung in <!-- nur: ${start[1]} -->`);
      }
      keep = conds.every((c) => (c === "claude" || c === "codex" ? c === target : c === form));
      open = true;
      continue;
    }
    if (/^\s*<!--\s*\/nur\s*-->\s*$/.test(line)) {
      if (!open) throw new Error("<!-- /nur --> ohne Anfang");
      keep = true;
      open = false;
      continue;
    }
    if (keep) out.push(line);
  }
  if (open) throw new Error("<!-- nur --> Block nicht geschlossen");
  return (
    out
      .join("\n")
      .replaceAll(KB_PLACEHOLDER, config.kbRoot)
      .replace(/<DEV_POOL>/g, String(config.devPool))
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n"
  );
}

function prefixed(head, prefix) {
  return Object.fromEntries(
    Object.entries(head)
      .filter(([k]) => k.startsWith(prefix + "."))
      .map(([k, v]) => [k.slice(prefix.length + 1), v]),
  );
}

const list = (v) =>
  v
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
const yamlString = (s) => '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';

// ---------- Claude-Ausgaben ----------

function claudeAgent(role) {
  const c = prefixed(role.head, "claude");
  const name = c.name || role.head.name;
  delete c.name;
  const description = role.head["subagent.description"] || role.head.description;
  const lines = ["---", `name: ${name}`, `description: ${yamlString(description)}`];
  for (const [k, v] of Object.entries(c)) lines.push(`${k}: ${v}`);
  lines.push("---", `<!-- ${MARKER} -->`, "", filterBody(role.body, "claude", "subagent"));
  return [`.claude/agents/${name}.md`, lines.join("\n")];
}

function claudeOutputStyle(role, chatBasis) {
  const style = role.head["chat.style"];
  const body =
    filterBody(role.body, "claude", "chat") + "\n" + filterBody(chatBasis, "claude", "chat");
  const lines = [
    "---",
    `name: ${style}`,
    `description: ${yamlString(role.head.description)}`,
    "keep-coding-instructions: true",
    "---",
    `<!-- ${MARKER} -->`,
    "",
    body,
  ];
  return [`.claude/output-styles/${style}.md`, lines.join("\n")];
}

// Maschinenlesbare Rollenbeschreibung für Hooks und Teamaufbau
function rolesJson(roles) {
  const chats = roles
    .filter((r) => r.forms.includes("chat"))
    .map((r) => {
      const c = prefixed(r.head, "chat");
      return {
        role: r.head.name,
        title: c.title,
        style: c.style,
        external: c.external === "true",
        main: c.main === "true",
        worktree: c.worktree === "true",
        models_order: list(c.model),
        model: list(c.model)[0] ?? null,
        effort: c.effort ?? null,
        models: list(c.models),
        subagents: list(c.subagents),
      };
    });
  return (
    JSON.stringify(
      { _hinweis: MARKER, devPool: config.devPool, kbRoot: config.kbRoot, testCommand, chats },
      null,
      2,
    ) + "\n"
  );
}

const SESSION_TOOLS_ALLOW = [
  "list_sessions",
  "get_session",
  "list_events",
  "search_session_transcripts",
  "set_session_title",
  "set_session_output_style",
  "set_session_model",
  "set_session_effort",
  "stop_session",
  "archive_session",
  "clear_session",
].map((t) => `mcp__ccd_session_mgmt__${t}`);

const SESSION_TOOLS_DENY = [
  "mcp__ccd_session_mgmt__delete_session",
  "mcp__ccd_session_mgmt__set_session_permission_mode",
  "mcp__ccd_session_mgmt__set_session_fast_mode",
  "mcp__ccd_session_mgmt__set_remote_control",
  "mcp__ccd_session__move_to_cloud",
];

function hookCommand(script) {
  return `node "$CLAUDE_PROJECT_DIR/team/hooks/${script}"`;
}

function claudeSettings(existing) {
  const s = existing ?? {};
  const c = config.claude;
  delete s.outputStyle; // Rollen werden pro Chat gesetzt, nicht projektweit
  s.model = c.model;
  s.effortLevel = c.effortLevel;
  s.worktree = { ...(s.worktree ?? {}), baseRef: "head" };

  s.permissions = s.permissions ?? {};
  if (c.defaultMode) s.permissions.defaultMode = c.defaultMode;
  const dirs = new Set(
    (s.permissions.additionalDirectories ?? []).filter((d) => d !== KB_PLACEHOLDER),
  );
  dirs.add(config.kbRoot);
  s.permissions.additionalDirectories = [...dirs];
  const merge = (current, add) => [...new Set([...(current ?? []), ...add])];
  const OLD = [
    "mcp__scheduled-tasks__run_scheduled_task",
    "mcp__scheduled-tasks__list_scheduled_tasks",
    "mcp__scheduled-tasks__list_task_runs",
  ];
  // Der Testbefehl des Projekts: der zuletzt erzeugte Eintrag (aus roles.json) wird ersetzt
  const testRule = (testCommand) => (testCommand ? `Bash(${testCommand})` : null);
  const staleRules = [...OLD, testRule(previousTestCommand())];
  s.permissions.allow = (s.permissions.allow ?? []).filter((r) => !staleRules.includes(r));
  s.permissions.allow = merge(s.permissions.allow, [
    ...SESSION_TOOLS_ALLOW,
    "mcp__ccd_session_mgmt__send_message",
    "SendMessage",
    "ListAgents",
    "Bash(node team/bootstrap.mjs*)",
    ...[testRule(testCommand)].filter(Boolean),
  ]);
  s.permissions.deny = merge(s.permissions.deny, SESSION_TOOLS_DENY);

  // Team-Hooks ersetzen, fremde Hooks behalten
  const own = {
    SessionStart: [{ hooks: [{ type: "command", command: hookCommand("session-start.mjs") }] }],
    PreToolUse: [
      {
        matcher: "^(mcp__ccd_session_mgmt__.*|mcp__scheduled-tasks__.*|Agent)$",
        hooks: [{ type: "command", command: hookCommand("policy.mjs") }],
      },
    ],
    PostToolUse: [
      {
        matcher: "mcp__ccd_session_mgmt__set_session_title",
        hooks: [{ type: "command", command: hookCommand("registry-title.mjs") }],
      },
    ],
  };
  s.hooks = s.hooks ?? {};
  for (const [event, groups] of Object.entries(own)) {
    const foreign = (s.hooks[event] ?? []).filter((g) => !JSON.stringify(g).includes(HOOK_MARK));
    s.hooks[event] = [...foreign, ...groups];
  }

  s.env = {
    ...(s.env ?? {}),
    CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: "3",
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "0",
  };
  return JSON.stringify(s, null, 2) + "\n";
}

// ---------- Generieren ----------

const roleFiles = fs.readdirSync(path.join(TEAM_DIR, "roles")).filter((f) => f.endsWith(".md"));
const chatBasis = fs
  .readFileSync(path.join(TEAM_DIR, "roles", "_chat-basis.md"), "utf8")
  .replace(/\r\n/g, "\n");
const roles = roleFiles
  .filter((f) => !f.startsWith("_"))
  .map((f) => parseRole(path.join(TEAM_DIR, "roles", f)));

const outputs = new Map(); // relativer Pfad -> Inhalt
const generatedDirs = [];

if (targets.includes("claude")) {
  generatedDirs.push(".claude/agents", ".claude/output-styles");
  for (const role of roles) {
    if (!role.targets.includes("claude")) continue;
    if (role.forms.includes("subagent")) outputs.set(...claudeAgent(role));
    if (role.forms.includes("chat")) outputs.set(...claudeOutputStyle(role, chatBasis));
  }
  const settingsPath = path.join(REPO, ".claude/settings.json");
  const existing = fs.existsSync(settingsPath)
    ? JSON.parse(fs.readFileSync(settingsPath, "utf8"))
    : null;
  outputs.set(".claude/settings.json", claudeSettings(existing));
}
outputs.set("team/roles.json", rolesJson(roles));

if (targets.includes("codex")) {
  console.warn(
    "Hinweis: Das Chat-Team ist für Codex noch nicht umgesetzt. .codex/ bleibt unverändert.",
  );
}

// veraltete generierte Dateien finden (Groß-/Kleinschreibung ignorieren, Windows und macOS unterscheiden sie nicht)
const wantedLower = new Set([...outputs.keys()].map((k) => k.toLowerCase()));
const stale = [];
for (const dir of generatedDirs) {
  const abs = path.join(REPO, dir);
  if (!fs.existsSync(abs)) continue;
  for (const f of fs.readdirSync(abs)) {
    const rel = `${dir}/${f}`;
    if (wantedLower.has(rel.toLowerCase())) continue;
    if (fs.readFileSync(path.join(abs, f), "utf8").includes(MARKER)) stale.push(rel);
  }
}

let changed = 0;
for (const [rel, content] of outputs) {
  const abs = path.join(REPO, rel);
  const old = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n") : null;
  if (old === content) continue;
  changed++;
  if (checkOnly) {
    console.log(`veraltet: ${rel}`);
    continue;
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  console.log(`geschrieben: ${rel}`);
}
for (const rel of stale) {
  changed++;
  if (checkOnly) {
    console.log(`überflüssig: ${rel}`);
    continue;
  }
  fs.rmSync(path.join(REPO, rel));
  console.log(`entfernt: ${rel}`);
}

// Worktree-Ordner gehören nicht ins Repo
const gitignore = path.join(REPO, ".gitignore");
const ignoreText = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, "utf8") : "";
const missing = [".claude/worktrees/", ".worktrees/"].filter(
  (e) => !ignoreText.split(/\r?\n/).includes(e),
);
if (missing.length) {
  changed++;
  if (checkOnly) console.log(`.gitignore fehlt: ${missing.join(", ")}`);
  else {
    const sep = ignoreText && !ignoreText.endsWith("\n") ? "\n" : "";
    fs.writeFileSync(gitignore, ignoreText + sep + missing.join("\n") + "\n");
    console.log(`.gitignore ergänzt: ${missing.join(", ")}`);
  }
}

console.log(`${checkOnly ? "Prüfung" : "Fertig"}: ${changed} Änderung(en).`);
if (checkOnly && changed) process.exit(1);
