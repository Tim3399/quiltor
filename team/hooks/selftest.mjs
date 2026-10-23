#!/usr/bin/env node
// Selbsttest der Team-Hooks gegen eine Wegwerf-Knowledgebase: node team/hooks/selftest.mjs
// Spielt die Rechtematrix aus AGENTS.md durch, ohne die echte Registry anzufassen.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOKS = path.dirname(fileURLToPath(import.meta.url));
const kb = fs.mkdtempSync(path.join(os.tmpdir(), 'team-kb-'));
let failed = 0;

function run(script, host, input) {
  const r = spawnSync(process.execPath, [path.join(HOOKS, script)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, TEAM_KB_OVERRIDE: kb, CLAUDE_CODE_HOST_SESSION_ID: host },
  });
  if (r.status !== 0) throw new Error(`${script} beendet mit ${r.status}: ${r.stderr}`);
  return r.stdout ? JSON.parse(r.stdout) : null;
}

const start = (host, title, model = 'claude-opus-5-5', source = 'startup') =>
  run('session-start.mjs', host, { source, session_title: title, model, session_id: `cli-${host}` });

function tool(host, name, input) {
  const out = run('policy.mjs', host, { tool_name: name, tool_input: input });
  return out?.hookSpecificOutput?.permissionDecision === 'deny' ? `deny: ${out.hookSpecificOutput.permissionDecisionReason}` : 'allow';
}
const mgmt = (host, action, input) => tool(host, `mcp__ccd_session_mgmt__${action}`, input);

function expect(name, actual, wanted) {
  const ok = wanted === 'allow' ? actual === 'allow' : actual.startsWith('deny');
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FEHL'} ${name}  →  ${actual}`);
}

// Chats anlegen
start('local_orch', 'Orchestrator');
start('local_impl', 'Implementer');
start('local_crit', 'Critic');
start('local_res', 'Researcher', 'claude-sonnet-5-5');
start('local_new', 'Neuer Chat');
start('local_new2', 'Noch ein Chat');
start('local_misc', 'Agent prompts für Orchestrator-System');

// Start-Hinweise
const hint = start('local_orch', 'Orchestrator', 'claude-haiku-5-5', 'compact').hookSpecificOutput.additionalContext;
expect('Startup: Rolle erkannt', hint.includes('Rolle orchestrator') ? 'allow' : 'deny: ' + hint, 'allow');
expect('Startup: nach compact Arbeitsstand lesen', hint.includes('komprimiert') && hint.includes('arbeitsstand.md') ? 'allow' : 'deny', 'allow');
expect('Startup: Modellwarnung bei Haiku', hint.includes('Achtung') ? 'allow' : 'deny', 'allow');
const noRole = start('local_misc', 'Agent prompts für Orchestrator-System').hookSpecificOutput.additionalContext;
expect('Startup: Chat ohne Rolle erkannt', noRole.includes('keine Team-Rolle') ? 'allow' : 'deny', 'allow');

// Teamaufbau: neuer Chat benennt sich selbst
expect('neuer Chat nennt sich Dev 3', mgmt('local_new', 'set_session_title', { session_id: 'self', title: 'Dev 3' }), 'allow');
run('registry-title.mjs', 'local_new', { tool_input: { session_id: 'self', title: 'Dev 3' }, tool_response: 'renamed' });
expect('zweiter Chat will auch Dev 3 heißen', mgmt('local_new2', 'set_session_title', { session_id: 'self', title: 'Dev 3' }), 'deny');
expect('neuer Chat will Critic heißen (schon vergeben)', mgmt('local_new2', 'set_session_title', { session_id: 'self', title: 'Critic' }), 'deny');
expect('neuer Chat will Orchestrator heißen (schon vergeben)', mgmt('local_new2', 'set_session_title', { session_id: 'self', title: 'Orchestrator' }), 'deny');
expect('neuer Chat übernimmt freien Titel Advisor', mgmt('local_new2', 'set_session_title', { session_id: 'self', title: 'Advisor' }), 'allow');
expect('Researcher will Advisor werden (hat schon Rolle)', mgmt('local_res', 'set_session_title', { session_id: 'self', title: 'Advisor' }), 'deny');
expect('Dev 9 liegt außerhalb des Pools', mgmt('local_new2', 'set_session_title', { session_id: 'self', title: 'Dev 9' }), 'allow');
expect('Dev 3 benennt sich um', mgmt('local_new', 'set_session_title', { session_id: 'self', title: 'Irgendwas' }), 'deny');
expect('Dev 3 setzt eigenen Stil Dev', mgmt('local_new', 'set_session_output_style', { session_id: 'self', style: 'Dev' }), 'allow');
expect('Dev 3 setzt eigenen Stil Orchestrator', mgmt('local_new', 'set_session_output_style', { session_id: 'self', style: 'Orchestrator' }), 'deny');
expect('Chat ohne Rolle nimmt Rollenstil', mgmt('local_misc', 'set_session_output_style', { session_id: 'self', style: 'Critic' }), 'deny');

// Orchestrator
expect('Orch setzt Modell von Dev 3 (Sonnet)', mgmt('local_orch', 'set_session_model', { session_id: 'local_new', model: 'claude-sonnet-5-5' }), 'allow');
expect('Orch setzt Modell von Dev 3 (Haiku)', mgmt('local_orch', 'set_session_model', { session_id: 'local_new', model: 'claude-haiku-5-5' }), 'deny');
expect('Orch setzt Stil von Researcher', mgmt('local_orch', 'set_session_output_style', { session_id: 'local_res', style: 'Researcher' }), 'allow');
expect('Orch setzt falschen Stil bei Researcher', mgmt('local_orch', 'set_session_output_style', { session_id: 'local_res', style: 'Dev' }), 'deny');
expect('Orch setzt Critic auf Fable', mgmt('local_orch', 'set_session_model', { session_id: 'local_crit', model: 'claude-fable-5-1' }), 'allow');
expect('Orch setzt Critic auf Opus (Ausweichmodell)', mgmt('local_orch', 'set_session_model', { session_id: 'local_crit', model: 'claude-opus-5-5' }), 'allow');
expect('Orch setzt Critic auf ein anderes Modell', mgmt('local_orch', 'set_session_model', { session_id: 'local_crit', model: 'claude-sonnet-5-5' }), 'deny');
expect('Orch setzt Critic auf vorgesehenen Effort', mgmt('local_orch', 'set_session_effort', { session_id: 'local_crit', effort: 'high' }), 'allow');
expect('Orch ändert Effort beim Critic', mgmt('local_orch', 'set_session_effort', { session_id: 'local_crit', effort: 'low' }), 'deny');
expect('Impl setzt Modell beim Critic', mgmt('local_impl', 'set_session_model', { session_id: 'local_crit', model: 'claude-opus-5-5' }), 'deny');
expect('Orch stoppt Critic (extern)', mgmt('local_orch', 'stop_session', { session_id: 'local_crit' }), 'deny');
expect('Orch stoppt Implementer', mgmt('local_orch', 'stop_session', { session_id: 'local_impl' }), 'allow');
expect('Orch archiviert Dev', mgmt('local_orch', 'archive_session', { session_id: 'local_new' }), 'deny');
expect('Orch leert anderen Chat', mgmt('local_orch', 'clear_session', { session_id: 'local_impl' }), 'deny');
expect('Orch leert sich selbst', mgmt('local_orch', 'clear_session', { session_id: 'self' }), 'allow');
expect('Orch löscht Chat', mgmt('local_orch', 'delete_session', { session_ids: ['local_new'] }), 'deny');
expect('Orch ändert Rechte-Modus', mgmt('local_orch', 'set_session_permission_mode', { session_id: 'local_new', mode: 'bypassPermissions' }), 'deny');
expect('Orch liest Sessions', mgmt('local_orch', 'list_sessions', {}), 'allow');

// Implementer und Pool
expect('Impl setzt Modell von Dev 3 (Opus)', mgmt('local_impl', 'set_session_model', { session_id: 'local_new', model: 'claude-opus-5-5' }), 'allow');
expect('Impl setzt Modell von Researcher', mgmt('local_impl', 'set_session_model', { session_id: 'local_res', model: 'claude-sonnet-5-5' }), 'deny');
fs.mkdirSync(path.join(kb, 'implementer'), { recursive: true });
const pool = status => fs.writeFileSync(path.join(kb, 'implementer', 'dev-pool.json'), JSON.stringify({ slots: [{ title: 'Dev 3', status }] }));
pool('belegt');
expect('Impl archiviert belegten Dev 3', mgmt('local_impl', 'archive_session', { session_id: 'local_new' }), 'deny');
pool('defekt');
expect('Impl archiviert defekten Dev 3', mgmt('local_impl', 'archive_session', { session_id: 'local_new' }), 'allow');
expect('Impl archiviert Researcher', mgmt('local_impl', 'archive_session', { session_id: 'local_res' }), 'deny');

// Andere Rollen und Chats ohne Rolle
expect('Researcher setzt Modell von Dev 3', mgmt('local_res', 'set_session_model', { session_id: 'local_new', model: 'claude-sonnet-5-5' }), 'deny');
expect('Chat ohne Rolle stoppt Implementer', mgmt('local_misc', 'stop_session', { session_id: 'local_impl' }), 'deny');
expect('Critic leert sich selbst', mgmt('local_crit', 'clear_session', { session_id: 'self' }), 'allow');

// Routinen
const routine = (host, action, input) => tool(host, `mcp__scheduled-tasks__${action}`, input);
expect('Orch startet Routine', routine('local_orch', 'run_scheduled_task', { taskId: 'irgendwas' }), 'deny');
expect('Chat ohne Rolle legt Routine an', routine('local_misc', 'create_scheduled_task', { taskId: 'x', prompt: 'x', description: 'x' }), 'allow');

// Fremde Werkzeuge
expect('Orch ruft ListAgents', tool('local_orch', 'ListAgents', {}), 'allow');
expect('Dev ruft SendMessage', tool('local_new', 'SendMessage', { to: 'Implementer', message: 'x' }), 'allow');

// Subagents
expect('Orch startet Explore', tool('local_orch', 'Agent', { subagent_type: 'Explore' }), 'allow');
expect('Orch startet dev', tool('local_orch', 'Agent', { subagent_type: 'dev' }), 'deny');
expect('Orch startet general-purpose (ohne Typ)', tool('local_orch', 'Agent', {}), 'deny');
expect('Impl startet dev', tool('local_impl', 'Agent', { subagent_type: 'dev' }), 'allow');
expect('Critic startet general-purpose', tool('local_crit', 'Agent', { subagent_type: 'general-purpose' }), 'allow');
expect('Chat ohne Rolle startet beliebig', tool('local_misc', 'Agent', { subagent_type: 'general-purpose' }), 'allow');

// Kaputte Registry: fremde Chats verwalten gesperrt, Selbsteinrichtung erlaubt, Registry bleibt unverändert
const registry = path.join(kb, 'team', 'registry.json');
fs.writeFileSync(registry, '{ kaputt');
expect('kaputte Registry: Orch setzt Modell von Dev 3', mgmt('local_orch', 'set_session_model', { session_id: 'local_new', model: 'claude-sonnet-5-5' }), 'deny');
expect('kaputte Registry: Orch stoppt Implementer', mgmt('local_orch', 'stop_session', { session_id: 'local_impl' }), 'deny');
expect('kaputte Registry: Chat nennt sich Dev 4', mgmt('local_fresh', 'set_session_title', { session_id: 'self', title: 'Dev 4' }), 'allow');
expect('kaputte Registry: Chat setzt Stil Dev', mgmt('local_fresh', 'set_session_output_style', { session_id: 'self', style: 'Dev' }), 'allow');
expect('kaputte Registry: Chat leert sich selbst', mgmt('local_fresh', 'clear_session', { session_id: 'self' }), 'allow');
start('local_fresh', 'Dev 4');
expect('kaputte Registry: Start-Hook lässt sie unverändert', fs.readFileSync(registry, 'utf8') === '{ kaputt' ? 'allow' : 'deny', 'allow');

fs.rmSync(kb, { recursive: true, force: true });
console.log(failed ? `\n${failed} Test(s) fehlgeschlagen.` : '\nAlle Tests bestanden.');
process.exit(failed ? 1 : 0);
