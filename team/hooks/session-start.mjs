// SessionStart-Hook (startup, resume, clear, compact, fork):
// trägt den Chat in die Registry ein und sagt ihm, welche Rolle er hat und wo sein Arbeitsstand liegt.
// Nach clear und compact ist das der Anker, an dem sich die Rolle wieder aufrichtet.

import {
  readInput,
  hostId,
  registerTitle,
  readRegistry,
  holderOf,
  workStatePath,
  chatOf,
  KB,
  REGISTRY,
} from "./lib.mjs";

const input = readInput();
const id = hostId();
const source = input.source ?? "startup";

let entry = null;
const { reg, broken } = readRegistry();
if (id) {
  const known = reg[id];
  entry = registerTitle(id, input.session_title ?? known?.title ?? null, {
    sessionId: input.session_id ?? null,
    cwd: input.cwd ?? null,
  });
}

const lines = [];
if (broken) {
  lines.push(
    `Achtung: Die Team-Registry ${REGISTRY} ist kaputt (${broken}) und wurde nicht verändert. Die Verwaltung anderer Chats ist gesperrt. Sag das dem User zu Beginn deiner nächsten Antwort.`,
  );
} else if (!entry?.role) {
  lines.push(
    `Team: Dieser Chat hat keine Team-Rolle (Titel: ${entry?.title ?? "unbekannt"}). Werkzeuge zur Verwaltung anderer Chats sind für ihn gesperrt.`,
  );
} else {
  const chat = chatOf(entry.role);
  const state = workStatePath(entry);
  lines.push(
    `Team: Dieser Chat ist „${entry.title}“ (Rolle ${entry.role}). Dein Arbeitsstand: ${state}`,
  );
  const dup = holderOf(entry.title, id);
  if (dup)
    lines.push(
      `Achtung: Der Titel „${entry.title}“ ist in der Registry auch für ${dup} eingetragen. Melde das dem User.`,
    );

  const reread = {
    clear: "Der Kontext wurde geleert.",
    compact: "Der Kontext wurde komprimiert, Details können fehlen.",
    resume: "Die Sitzung wurde fortgesetzt.",
    fork: "Dies ist eine Abspaltung einer anderen Sitzung.",
  }[source];
  const must = [state];
  if (entry.role === "orchestrator")
    must.push(`${KB}/orchestrator/roadmap.md`, `${KB}/orchestrator/taskboard.md`);
  if (entry.role === "implementer") must.push(`${KB}/implementer/dev-pool.json`);
  if (reread)
    lines.push(
      `${reread} Lies zuerst: ${must.join(", ")}. Verlass dich nicht auf Erinnerungen aus dem Gespräch.`,
    );
  else lines.push(`Lies vor dem ersten Auftrag: ${must.join(", ")}.`);

  lines.push(
    `Adressieren: Chats per Session-ID aus ${KB}/team/registry.json ansprechen (SendMessage an die local_…-ID, notfalls send_message). Per Titel sind Routinen-Chats nicht erreichbar.`,
  );

  if (
    input.model &&
    chat?.models?.length &&
    !chat.models.some((m) => input.model.toLowerCase().includes(m.toLowerCase()))
  ) {
    lines.push(
      `Achtung: Dieser Chat läuft auf ${input.model}, die Rolle verlangt ${chat.models.join(" oder ")}. Sag das dem User zu Beginn deiner nächsten Antwort.`,
    );
  }
}

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: lines.join("\n") },
  }),
);
