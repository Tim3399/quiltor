// The author's choice for an ambiguous proposal of a world extraction (T-344, D-244).
//
// When a name in the manuscript fits several elements ("Herr Brandt" for Oda and Karl Brandt),
// the server keeps the proposal and names the candidates. Nothing is created until the author
// chooses: one of the candidates (then nothing is created, and what hangs on the proposal's
// tempId points at that element) or a new element.
import type { AssistantProposal, AssistantReply } from "./model";

/** What the author chose: a candidate's id, or a new element. */
export const CREATE_NEW = "new";

/** Why a proposal cannot be applied yet, if it cannot. */
export type CandidateBlock = "choose" | "dependent";

/** The tempIds of the ambiguous proposals of a reply, by index. */
function ambiguousTempIds(reply: AssistantReply): Map<number, string> {
  const ambiguous = new Map<number, string>();
  reply.proposals.forEach((proposal, index) => {
    if (proposal.kind !== "create_element") return;
    if (reply.proposalEnvelopes?.[index]?.resolution?.outcome === "ambiguous") {
      ambiguous.set(index, proposal.tempId);
    }
  });
  return ambiguous;
}

/** Every string a proposal refers to another object by. */
function references(proposal: AssistantProposal): string[] {
  const found: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") found.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  const { kind: _kind, ...rest } = proposal;
  if (proposal.kind === "create_element") walk({ ...rest, tempId: undefined });
  else walk(rest);
  return found;
}

/** Whether proposal ``index`` must wait for a choice, and why. */
export function candidateBlock(
  reply: AssistantReply,
  choices: Record<number, string>,
  index: number,
  proposal: AssistantProposal = reply.proposals[index],
): CandidateBlock | null {
  const ambiguous = ambiguousTempIds(reply);
  if (ambiguous.has(index) && !choices[index]) return "choose";
  const open = new Set(
    [...ambiguous].filter(([other]) => !choices[other]).map(([, tempId]) => tempId),
  );
  return references(proposal).some((value) => open.has(value)) ? "dependent" : null;
}

/** The tempIds the author has resolved to an existing element, and to which. */
export function chosenElements(
  reply: AssistantReply,
  choices: Record<number, string>,
): Map<string, string> {
  const chosen = new Map<string, string>();
  for (const [index, tempId] of ambiguousTempIds(reply)) {
    const choice = choices[index];
    if (choice && choice !== CREATE_NEW) chosen.set(tempId, choice);
  }
  return chosen;
}

/** ``proposal`` with every reference to a resolved tempId pointing at the chosen element. */
export function withChosenElements(
  proposal: AssistantProposal,
  chosen: Map<string, string>,
): AssistantProposal {
  if (!chosen.size) return proposal;
  const swap = (value: unknown): unknown => {
    if (typeof value === "string") return chosen.get(value) ?? value;
    if (Array.isArray(value)) return value.map(swap);
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, swap(item)]));
    return value;
  };
  return swap(proposal) as AssistantProposal;
}

/** Whether applying proposal ``index`` creates nothing: the author chose an existing element. */
export function resolvedToExisting(
  reply: AssistantReply,
  choices: Record<number, string>,
  index: number,
): boolean {
  const choice = choices[index];
  return ambiguousTempIds(reply).has(index) && !!choice && choice !== CREATE_NEW;
}
