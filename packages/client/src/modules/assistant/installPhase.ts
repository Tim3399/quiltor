/**
 * What the assistant is actually doing behind its percentage.
 *
 * Setting the assistant up is two downloads of wildly different size: a llama.cpp
 * runtime of some fifteen megabytes, and then a language model of two and a half
 * gigabytes. A bare percentage that runs to a hundred and starts again reads as a
 * stall or a loop, and the small one finishing looks like the whole thing failed
 * to fetch a model. Saying which step is running removes the confusion entirely.
 *
 * The installer reports its own step: a handful of fixed markers, and otherwise
 * the name of the file it is fetching. The markers are translated; a filename is
 * shown as it is, because it is already the most informative thing on screen.
 */

import type { MessageKey } from "../../i18n";

const PHASE_MESSAGES: Record<string, MessageKey> = {
  Runtime: "installPhaseRuntime",
  Model: "installPhaseModel",
  "Smoke test": "installPhaseVerifying",
};

export function installPhaseLabel(phase: string, t: (key: MessageKey) => string): string {
  const reported = phase.trim();
  if (!reported) return "";
  const known = PHASE_MESSAGES[reported];
  return known ? t(known) : reported;
}

/** The whole progress caption: the step if one is known, the percentage always. */
export function installStepLabel(
  state: { phase: string; percent: number },
  t: (key: MessageKey) => string,
): string {
  const percent = String(state.percent);
  const step = installPhaseLabel(state.phase, t);
  if (!step) return t("installingAssistant").replace("{percent}", percent);
  return t("installingAssistantStep").replace("{phase}", step).replace("{percent}", percent);
}
