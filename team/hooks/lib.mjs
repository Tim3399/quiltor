// Gemeinsame Helfer für die Team-Hooks: Konfiguration, Rollen, Registry der Chats.
//
// Die Registry ordnet jeder App-Session-ID (CLAUDE_CODE_HOST_SESSION_ID, z. B. "local_…") ihren Titel
// und ihre Rolle zu. Geschrieben wird sie vom SessionStart-Hook und nach einem Umbenennen.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEAM_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Fail closed: Ohne lesbare Konfiguration und Rollen entscheidet kein Hook. Exit 2 wertet Claude Code als Block.
export function fail(message) {
  process.stderr.write(`Team-Hook: ${message}\n`);
  process.exit(2);
}

function readTeamJson(name, valid) {
  const file = path.join(TEAM_DIR, name);
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    fail(
      `${file} ist nicht lesbar oder kein gültiges JSON (${e.message}). Behebe die Datei, z. B. mit node team/sync.mjs.`,
    );
  }
  if (!valid(value))
    fail(`${file} hat nicht das erwartete Format. Behebe die Datei, z. B. mit node team/sync.mjs.`);
  return value;
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export const config = readTeamJson("team.config.json", isObject);
export const roles = readTeamJson("roles.json", (v) => isObject(v) && Array.isArray(v.chats));
export const KB = process.env.TEAM_KB_OVERRIDE || config.kbRoot; // Override nur für Tests und team/hooks/selftest.mjs
export const REGISTRY = path.join(KB, "team", "registry.json");

// strict: Unlesbare oder leere Eingabe und alles außer einem JSON-Objekt blockiert (fail).
// Ohne strict wird daraus {} (für Hooks, die nichts entscheiden).
export function readInput({ strict = false } = {}) {
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8") || (strict ? "" : "{}"));
  } catch (e) {
    if (strict)
      fail(`Die Hook-Eingabe auf stdin ist nicht lesbar oder kein gültiges JSON (${e.message}).`);
    return {};
  }
  if (strict && !isObject(input)) fail("Die Hook-Eingabe auf stdin ist kein JSON-Objekt.");
  return input;
}

export const hostId = () => process.env.CLAUDE_CODE_HOST_SESSION_ID || null;

// Titel -> { role, title, slot, chat } oder null. "Dev {n}" passt auf Dev 1 … Dev <devPool>.
export function roleForTitle(title) {
  if (!title) return null;
  const t = title.trim();
  for (const chat of roles.chats) {
    if (chat.title.includes("{n}")) {
      const re = new RegExp(
        "^" + chat.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("\\{n\\}", "(\\d+)") + "$",
        "i",
      );
      const m = t.match(re);
      if (m) {
        const slot = Number(m[1]);
        if (slot >= 1 && slot <= roles.devPool)
          return { role: chat.role, title: chat.title.replace("{n}", slot), slot, chat };
      }
    } else if (t.toLowerCase() === chat.title.toLowerCase()) {
      return { role: chat.role, title: chat.title, slot: null, chat };
    }
  }
  return null;
}

export const chatOf = (roleName) => roles.chats.find((c) => c.role === roleName) ?? null;

// { reg, missing, broken }: Eine fehlende Registry ist beim ersten Start normal (leer).
// broken enthält den Grund, wenn sie vorhanden, aber nicht lesbar oder kein JSON-Objekt ist.
export function readRegistry() {
  let text;
  try {
    text = fs.readFileSync(REGISTRY, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return { reg: {}, missing: true, broken: null };
    return { reg: {}, missing: false, broken: e.message };
  }
  try {
    const reg = JSON.parse(text);
    if (!isObject(reg)) throw new Error("kein JSON-Objekt");
    return { reg, missing: false, broken: null };
  } catch (e) {
    return { reg: {}, missing: false, broken: e.message };
  }
}

export const loadRegistry = () => readRegistry().reg;

export function saveRegistry(reg) {
  fs.mkdirSync(path.dirname(REGISTRY), { recursive: true });
  const tmp = `${REGISTRY}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2) + "\n");
  fs.renameSync(tmp, REGISTRY);
}

// Kaputte Registry nie durch eine leere überschreiben: Meldung auf stderr, Rückgabe null.
export function registerTitle(id, title, extra = {}) {
  const { reg, broken } = readRegistry();
  if (broken) {
    process.stderr.write(
      `Team-Hook: ${REGISTRY} ist kaputt (${broken}) und bleibt unverändert. Chat ${id} wurde nicht eingetragen.\n`,
    );
    return null;
  }
  const r = roleForTitle(title);
  reg[id] = {
    ...(reg[id] ?? {}),
    ...extra,
    title: title ?? reg[id]?.title ?? null,
    role: r?.role ?? null,
    slot: r?.slot ?? null,
    updatedAt: new Date().toISOString(),
  };
  saveRegistry(reg);
  return reg[id];
}

// Wer hält einen Rollentitel gerade (außer id)?
export function holderOf(title, exceptId) {
  const reg = loadRegistry();
  return (
    Object.entries(reg).find(
      ([id, e]) => id !== exceptId && e.title && e.title.toLowerCase() === title.toLowerCase(),
    )?.[0] ?? null
  );
}

// Pfad zur Arbeitsstand-Datei einer Rolle
export function workStatePath(entry) {
  if (!entry?.role) return null;
  if (entry.role === "dev" && entry.slot)
    return path.join(KB, "dev", `dev-${entry.slot}`, "arbeitsstand.md").replace(/\\/g, "/");
  return path.join(KB, entry.role, "arbeitsstand.md").replace(/\\/g, "/");
}

export function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}
