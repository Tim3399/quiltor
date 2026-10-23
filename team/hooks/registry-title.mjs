// PostToolUse-Hook für set_session_title: hält die Registry aktuell, wenn sich ein Chat selbst umbenennt
// (zum Beispiel beim Teamaufbau, wenn ein neuer Chat sich „Dev 3“ nennt).

import { readInput, hostId, registerTitle } from './lib.mjs';

const input = readInput();
const id = hostId();
const target = input.tool_input?.session_id;
const title = input.tool_input?.title;
const response = JSON.stringify(input.tool_response ?? '').toLowerCase();
const failed = /error|refused|denied|declined|not renamed/.test(response);

if (id && title && target === 'self' && !failed) registerTitle(id, title);
