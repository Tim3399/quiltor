#!/usr/bin/env node
// Teamaufbau mit leeren Chats: Der User legt normale Chats an und schickt in jeden denselben Prompt
// (siehe team/TEAM-BEITRETEN.txt). Jeder Chat ruft „claim“ auf, bekommt die nächste freie Rolle und richtet
// sich selbst ein.
//
//   node team/bootstrap.mjs claim       nächste freie Rolle für diesen Chat (Startanweisung auf stdout)
//   node team/bootstrap.mjs plan        fehlende Rollen in Startreihenfolge (JSON)
//   node team/bootstrap.mjs deeplink    Ausweichweg: fehlende Chats per Link öffnen (ein Klick pro Chat)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { roles, loadRegistry, workStatePath, KB } from './hooks/lib.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const START_DIR = path.join(KB, 'team', 'start');
const [command, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter(a => a.startsWith('--')));
const names = rest.filter(a => !a.startsWith('--')).map(a => a.toLowerCase());
const WAIT_MINUTES = Number(rest.find(a => a.startsWith('--minutes='))?.split('=')[1] ?? 15);

const registered = () => new Set(Object.values(loadRegistry()).map(e => e.title?.toLowerCase()).filter(Boolean));

// Alle Chats, die es geben soll, in Startreihenfolge: Orchestrator, extern, intern
function allChats() {
  const order = c => (c.main ? 0 : c.external ? 1 : 2);
  return [...roles.chats].sort((a, b) => order(a) - order(b)).flatMap(chat =>
    chat.title.includes('{n}')
      ? Array.from({ length: roles.devPool }, (_, i) => ({ ...chat, title: chat.title.replace('{n}', i + 1), slot: i + 1 }))
      : [{ ...chat, slot: null }],
  );
}

function missing({ intern = false, withMain = true } = {}) {
  const taken = registered();
  return allChats().filter(c => {
    if (taken.has(c.title.toLowerCase())) return false;
    if (!withMain && c.main) return false;
    if (intern && (c.main || c.external)) return false;
    if (names.length && !names.includes(c.title.toLowerCase()) && !names.includes(c.role)) return false;
    return true;
  });
}

const byTitle = title => allChats().find(c => c.title.toLowerCase() === title?.toLowerCase());
const slug = c => c.title.toLowerCase().replace(/\s+/g, '-');
const fwd = p => p.split(path.sep).join('/');
const worktreeName = c => (c.slot ? `${c.role}-${c.slot}` : c.role);

function startPrompt(c) {
  const state = workStatePath({ role: c.role, slot: c.slot });
  const steps = [
    `Benenne diesen Chat: set_session_title mit session_id "self" und title "${c.title}".`,
    `Setze deinen Rollenstil: set_session_output_style mit session_id "self" und style "${c.style}".`,
  ];
  if (c.worktree) steps.push(`Wechsle in deinen eigenen Worktree: EnterWorktree mit dem Namen "${worktreeName(c)}". Dort arbeitest du ab jetzt immer.`);
  steps.push(`Lege deinen Arbeitsstand an, falls er fehlt: ${state} mit dem Inhalt „Status: frei, kein Auftrag“.`);
  if (c.main) {
    steps.push('Prüfe mit get_session (session_id "self"), ob du auf Opus läufst. Wenn nicht, sag dem User, er soll im Modell-Menü dieses Chats Opus wählen.');
  } else {
    steps.push(`Melde dich beim Orchestrator mit der Nachricht „${c.title} bereit“. Seine Session-ID steht in ${fwd(KB)}/team/registry.json (Eintrag mit title "Orchestrator"). Sende per SendMessage an diese ID, falls das scheitert per send_message. Ist noch kein Orchestrator eingetragen, überspringst du diesen Schritt. Der Orchestrator findet dich dann in der Registry.`);
  }
  return [
    `Teamaufbau: Dieser Chat wird „${c.title}“ (Rolle ${c.role}). Richte dich jetzt selbst ein, ohne Rückfragen:`,
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    c.main
      ? 'Danach beendest du diesen Turn. Ab deiner nächsten Antwort gilt deine Rolle.'
      : 'Danach nichts weiter tun und auf Aufträge warten. Deine Rolle gilt ab deiner nächsten Antwort. Dein Modell setzt der Orchestrator.',
  ].join('\n');
}

// Dev-Pool anlegen, falls er fehlt (Pflege danach nur durch den Implementer)
function ensurePool() {
  const file = path.join(KB, 'implementer', 'dev-pool.json');
  if (fs.existsSync(file)) return;
  const slots = allChats().filter(c => c.role === 'dev').map(c => ({ title: c.title, status: 'frei', auftrag: null, branch: null, seit: null }));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ slots }, null, 2) + '\n');
  console.error(`Dev-Pool angelegt: ${file}`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(title) {
  const until = Date.now() + WAIT_MINUTES * 60_000;
  while (Date.now() < until) {
    if (registered().has(title.toLowerCase())) return true;
    await sleep(3000);
  }
  return false;
}

function openDeepLink(c) {
  const file = path.join(START_DIR, `${c.title.toLowerCase().replace(/\s+/g, '-')}.md`);
  fs.mkdirSync(START_DIR, { recursive: true });
  fs.writeFileSync(file, startPrompt(c) + '\n');
  const q = `Teamaufbau: Dieser Chat wird „${c.title}“. Lies die Datei ${file.replace(/\\/g, '/')} und führe die Schritte darin aus, ohne Rückfragen.`;
  const url = `claude://code/new?q=${encodeURIComponent(q)}&folder=${encodeURIComponent(REPO)}`;
  const [cmd, cmdArgs] =
    process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore' }).unref();
}

// ---------- Befehle ----------

switch (command) {
  // Ein frischer, leerer Chat beansprucht die nächste freie Rolle und bekommt seine Startanweisung.
  // Reihenfolge: Orchestrator, extern (Critic, Advisor), intern. Doppelvergabe verhindert eine Claim-Datei
  // pro Titel (atomar per 'wx'). Claims ohne Registrierung verfallen nach 10 Minuten.
  case 'claim': {
    ensurePool();
    const host = process.env.CLAUDE_CODE_HOST_SESSION_ID;
    if (!host) { console.log('Kein Team-Chat der Desktop-App (CLAUDE_CODE_HOST_SESSION_ID fehlt). Abbruch.'); process.exit(2); }
    const own = loadRegistry()[host];
    if (own?.role) { console.log(`Dieser Chat ist bereits „${own.title}“. Nichts zu tun.`); break; }
    const claimDir = path.join(KB, 'team', 'claims');
    fs.mkdirSync(claimDir, { recursive: true });
    const taken = registered();
    for (const c of allChats()) {
      if (taken.has(c.title.toLowerCase())) continue;
      const file = path.join(claimDir, `${slug(c)}.json`);
      if (fs.existsSync(file)) {
        const old = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (old.host === host) { console.log(startPrompt(c)); process.exit(0); }
        if (Date.now() - Date.parse(old.at) < 10 * 60_000) continue;
        fs.rmSync(file, { force: true });
      }
      try {
        fs.writeFileSync(file, JSON.stringify({ host, at: new Date().toISOString() }), { flag: 'wx' });
      } catch {
        continue; // gleichzeitig von einem anderen Chat beansprucht
      }
      console.log(startPrompt(c));
      process.exit(0);
    }
    console.log('Alle Rollen sind vergeben. Dieser Chat wird nicht gebraucht und kann archiviert werden.');
    break;
  }

  case 'plan': {
    ensurePool();
    const list = missing({ intern: flags.has('--intern'), withMain: false });
    console.log(JSON.stringify(list.map(c => ({ title: c.title, role: c.role, models: c.models_order, effort: c.effort, external: c.external })), null, 2));
    break;
  }

  case 'deeplink': {
    ensurePool();
    const list = missing({ intern: flags.has('--intern') });
    if (!list.length) { console.log('Alle gewünschten Rollen-Chats sind bereits eingetragen.'); break; }
    if (flags.has('--print')) {
      for (const c of list) console.log(`\n--- ${c.title} ---\n${startPrompt(c)}`);
      break;
    }
    // Die App behält nur ein offenes, nicht abgeschicktes Eingabefeld: Chats einzeln nacheinander öffnen.
    console.log(`Öffne nacheinander ${list.length} Chat(s): ${list.map(c => c.title).join(', ')}`);
    for (const [i, c] of list.entries()) {
      console.log(`\n[${i + 1}/${list.length}] ${c.title}: Ordner bestätigen und Nachricht absenden …`);
      openDeepLink(c);
      if (!(await waitFor(c.title))) { console.log('Keine Registrierung, Abbruch. Später erneut starten.'); process.exit(1); }
    }
    console.log('Alle Chats sind eingerichtet.');
    break;
  }

  default:
    console.log('Befehle: claim | plan [--intern] | deeplink [--intern] [--print]');
    process.exit(command ? 2 : 0);
}
