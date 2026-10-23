// PreToolUse-Hook („Türsteher“) für die Chat-Verwaltung der App und das Starten von Subagents.
//
// Rechtematrix (siehe AGENTS.md):
//   Orchestrator: Rolle (Output-Style), Modell, Effort setzen und Turns stoppen bei internen Rollen-Chats
//   Implementer:  dasselbe nur bei Dev-Chats, dazu Dev-Chats archivieren, wenn sie im Pool nicht belegt sind
//   Alle:         sich selbst leeren und ihren eigenen Rollentitel/-stil setzen
//   Critic, Advisor: extern, von keinem Agent veränderbar
// Löschen, Rechte-Modus, Fast-Mode, Remote Control und Cloud-Umzug sperren die Settings ganz.
//
// Nur „deny“ wird ausgegeben. Erlaubte Aufrufe laufen still weiter in die normale Rechteprüfung
// (dort stehen die passenden allow-Regeln).

import fs from 'node:fs';
import path from 'node:path';
import { readInput, hostId, readRegistry, roleForTitle, holderOf, chatOf, deny, fail, roles, KB, REGISTRY } from './lib.mjs';

// Jeder unerwartete Fehler blockiert (Exit 2), statt still durchzulassen.
try {
  main();
} catch (e) {
  fail(`policy.mjs ist abgebrochen: ${e?.stack ?? e}`);
}

function main() {
  const input = readInput({ strict: true });
  const tool = input.tool_name ?? '';
  const args = input.tool_input ?? {};
  const id = hostId();
  const { reg, missing, broken } = readRegistry();
  const caller = id ? reg[id] : null;
  const callerRole = caller?.role ?? null;

  const READ_ONLY = ['list_sessions', 'get_session', 'list_events', 'search_session_transcripts', 'send_message'];
  // Selbsteinrichtung eines Chats (Teamaufbau) bleibt auch ohne lesbare Registry möglich
  const SELF_SETUP = ['set_session_title', 'set_session_output_style', 'clear_session'];

  // ---------- Subagents ----------
  if (tool === 'Agent') {
    const allowed = callerRole ? chatOf(callerRole)?.subagents ?? [] : [];
    if (callerRole && allowed.length) {
      const type = (args.subagent_type || 'general-purpose').toLowerCase();
      if (!allowed.some(a => a.toLowerCase() === type)) {
        deny(`Die Rolle ${callerRole} darf nur diese Subagents starten: ${allowed.join(', ')}. Angefragt war „${type}“.`);
      }
    }
    process.exit(0);
  }

  // ---------- Routinen ----------
  // Team-Chats verwalten keine Routinen. Chats ohne Rolle bleiben unberührt.
  if (tool.startsWith('mcp__scheduled-tasks__')) {
    if (callerRole) deny('Routinen sind für Team-Chats nicht vorgesehen.');
    process.exit(0);
  }

  // ---------- Chat-Verwaltung ----------
  // Alles, was nicht zur Chat-Verwaltung gehört (z. B. ListAgents, SendMessage), lässt der Türsteher durch.
  if (!tool.startsWith('mcp__ccd_session_mgmt__')) process.exit(0);
  const action = tool.replace(/^mcp__ccd_session_mgmt__/, '');
  if (READ_ONLY.includes(action)) process.exit(0);

  const self = args.session_id === 'self' || (id && args.session_id === id);

  // Ohne lesbare Registry sind Rollen unbekannt: Selbsteinrichtung erlaubt, fremde Chats verwalten gesperrt.
  if (missing || broken) {
    if (self && SELF_SETUP.includes(action)) process.exit(0);
    deny(broken
      ? `Die Team-Registry ${REGISTRY} ist kaputt (${broken}). Andere Chats verwalten ist gesperrt, bis der User sie repariert.`
      : `Die Team-Registry ${REGISTRY} fehlt. Andere Chats verwalten ist gesperrt, bis sich die Chats eingetragen haben.`);
  }
  const targetId = self ? id : args.session_id;
  const target = targetId ? reg[targetId] : null;
  const targetChat = target?.role ? chatOf(target.role) : null;
  const internal = targetChat && !targetChat.external && !targetChat.main;

  // Darf der Aufrufer diesen fremden Chat verwalten?
  // Einzige Ausnahme bei externen Chats: Der Orchestrator darf beim Teamaufbau genau das vorgesehene Modell setzen.
  function mayManage() {
    if (!target?.role) return `Der Ziel-Chat ist in der Team-Registry nicht als Rolle eingetragen.`;
    if (targetChat.external) {
      const setup = callerRole === 'orchestrator' && (
        (action === 'set_session_model' && (targetChat.models_order ?? [targetChat.model]).includes(args.model)) ||
        (action === 'set_session_effort' && args.effort === targetChat.effort));
      if (!setup) return `„${target.title}“ ist extern. Critic und Advisor verändert nur der User.`;
      return null;
    }
    if (callerRole === 'orchestrator' && internal) return null;
    if (callerRole === 'implementer' && target.role === 'dev') return null;
    return `Die Rolle ${callerRole ?? '(keine)'} darf „${target.title}“ nicht verwalten.`;
  }

  switch (action) {
    case 'clear_session':
      if (!self) deny('Chats leeren nur sich selbst (session_id "self").');
      break;

    case 'set_session_title': {
      if (!self) deny('Chats benennen nur sich selbst um.');
      const wanted = roleForTitle(args.title);
      if (callerRole && wanted?.title?.toLowerCase() !== caller.title?.toLowerCase()) {
        deny(`Dieser Chat ist „${caller.title}“ und behält seinen Rollentitel.`);
      }
      if (wanted) {
        // Ein Chat ohne Rolle darf einen freien Rollentitel übernehmen (Teamaufbau per Startnachricht des Users).
        // Wer schon eine Rolle hat, behält sie (siehe oben). Doppelte Titel sind nie erlaubt.
        const holder = holderOf(wanted.title, id);
        if (holder) deny(`Der Titel „${wanted.title}“ ist schon an einen anderen Chat vergeben (${holder}).`);
      }
      break;
    }

    case 'set_session_output_style': {
      const roleStyle = targetChat?.style;
      if (self) {
        if (callerRole && args.style !== chatOf(callerRole).style) deny(`Die Rolle ${callerRole} nutzt den Stil „${chatOf(callerRole).style}“.`);
        if (!callerRole && roles.chats.some(c => c.style === args.style)) deny('Ein Rollenstil passt nur zu einem Chat mit Rollentitel. Erst umbenennen.');
        break;
      }
      const why = mayManage();
      if (why) deny(why);
      if (args.style !== roleStyle) deny(`„${target.title}“ gehört zur Rolle ${target.role} und bekommt nur den Stil „${roleStyle}“.`);
      break;
    }

    case 'set_session_model':
    case 'set_session_effort':
    case 'stop_session': {
      if (self) break; // die App lehnt das für die eigene Session ohnehin ab
      const why = mayManage();
      if (why) deny(why);
      if (action === 'set_session_model') {
        const allowedModels = targetChat.models ?? [];
        if (allowedModels.length && !allowedModels.some(m => String(args.model).toLowerCase().includes(m.toLowerCase()))) {
          deny(`Für die Rolle ${target.role} sind nur diese Modelle vorgesehen: ${allowedModels.join(', ')}.`);
        }
      }
      break;
    }

    case 'archive_session': {
      if (self) deny('Ein Chat archiviert sich nicht selbst.');
      if (callerRole !== 'implementer' || target?.role !== 'dev') deny('Archivieren darf nur der Implementer, und nur Dev-Chats.');
      const pool = readPool();
      const slot = pool?.slots?.find(s => s.title?.toLowerCase() === target.title?.toLowerCase());
      if (slot?.status === 'belegt') deny(`„${target.title}“ ist im Dev-Pool als belegt eingetragen. Erst Arbeit abschließen und den Platz freigeben.`);
      break;
    }

    default:
      deny(`Das Werkzeug ${action} ist für Team-Chats nicht vorgesehen.`);
  }
  process.exit(0);
}

function readPool() {
  try {
    return JSON.parse(fs.readFileSync(path.join(KB, 'implementer', 'dev-pool.json'), 'utf8'));
  } catch {
    return null;
  }
}
