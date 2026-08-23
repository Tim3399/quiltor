import { useState, type RefObject } from "react";
import { Bot, Check, ChevronDown, EyeOff, Pencil, RotateCw } from "lucide-react";
import { useI18n } from "../../i18n";
import type { Workspace } from "../../shared";
import { SelectControl } from "../../shared/ui/SelectControl";
import type { FigureState } from "../story-world";
import type { AssistantBatchProgress, AssistantEntry } from "./conversationTypes";
import { resolveAssistantMessage } from "./formatting";
import type {
  AssistantClaimStatus,
  AssistantProposal,
  AssistantReply,
  AssistantSource,
} from "./model";
import { AssistantProposalEditor } from "./AssistantProposalEditor";
import { proposalLabel } from "./proposals";
import "./AssistantConversation.css";

export function AssistantConversation({
  entries,
  sending,
  batchProgress,
  batchProgressId,
  figures,
  endRef,
  onDraftChange,
  onRetry,
  onSendExplicit,
  onRunBatch,
  onOpenChapterPicker,
  onNavigate,
  onApply,
  onDismiss,
  onEdit,
  onClassifyClaim,
}: {
  entries: AssistantEntry[];
  sending: boolean;
  batchProgress: AssistantBatchProgress | null;
  batchProgressId: string;
  figures: FigureState;
  endRef: RefObject<HTMLDivElement | null>;
  onDraftChange: (value: string) => void;
  onRetry: (entryId: string) => void;
  onSendExplicit: (question: string) => void;
  onRunBatch: (entryId: string) => void;
  onOpenChapterPicker: () => void;
  onNavigate: (target: { workspace: Workspace; id: string }) => void;
  onApply: (entryId: string, proposals: AssistantProposal[], indices: number[]) => void;
  onDismiss: (entryId: string, index: number) => void;
  onEdit: (entryId: string, index: number, proposal: AssistantProposal) => void;
  onClassifyClaim: (entryId: string, index: number, claimStatus: AssistantClaimStatus) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="assistant-messages">
      {!entries.length && (
        <div className="assistant-empty">
          <Bot />
          <h2>{t("assistantGreeting")}</h2>
          <p>{t("assistantGreetingBody")}</p>
          <button onClick={() => onDraftChange(t("findMissingFiguresPrompt"))}>
            {t("findMissingFigures")}
          </button>
          <button onClick={() => onDraftChange(t("checkTimelinePrompt"))}>
            {t("checkTimeline")}
          </button>
        </div>
      )}
      {entries.map((entry) => (
        <AssistantExchange
          key={entry.id}
          entry={entry}
          figures={figures}
          sending={sending}
          onRetry={onRetry}
          onSendExplicit={onSendExplicit}
          onRunBatch={onRunBatch}
          onOpenChapterPicker={onOpenChapterPicker}
          onNavigate={onNavigate}
          onApply={onApply}
          onDismiss={onDismiss}
          onEdit={onEdit}
          onClassifyClaim={onClassifyClaim}
        />
      ))}
      {sending && batchProgress && (
        <div className="assistant-progress">
          <span id={batchProgressId}>
            {batchProgress.labelKey
              ? t(batchProgress.labelKey, batchProgress.labelParams)
              : t("processingChapterGroups")}{" "}
            {batchProgress.total ? `(${batchProgress.done}/${batchProgress.total})` : ""}
          </span>
          <div
            className="assistant-progress-bar"
            role="progressbar"
            aria-labelledby={batchProgressId}
            aria-valuenow={batchProgress.done}
            aria-valuemin={0}
            aria-valuemax={batchProgress.total || undefined}
          >
            <span
              style={{
                width: `${batchProgress.total ? Math.round((batchProgress.done / batchProgress.total) * 100) : 0}%`,
              }}
            />
          </div>
        </div>
      )}
      {sending && !batchProgress && (
        <div className="assistant-thinking">
          <span />
          <span />
          <span />
          {t("assistantSearchingWorld")}
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

function AssistantExchange({
  entry,
  figures,
  sending,
  onRetry,
  onSendExplicit,
  onRunBatch,
  onOpenChapterPicker,
  onNavigate,
  onApply,
  onDismiss,
  onEdit,
  onClassifyClaim,
}: {
  entry: AssistantEntry;
  figures: FigureState;
  sending: boolean;
  onRetry: (entryId: string) => void;
  onSendExplicit: (question: string) => void;
  onRunBatch: (entryId: string) => void;
  onOpenChapterPicker: () => void;
  onNavigate: (target: { workspace: Workspace; id: string }) => void;
  onApply: (entryId: string, proposals: AssistantProposal[], indices: number[]) => void;
  onDismiss: (entryId: string, index: number) => void;
  onEdit: (entryId: string, index: number, proposal: AssistantProposal) => void;
  onClassifyClaim: (entryId: string, index: number, claimStatus: AssistantClaimStatus) => void;
}) {
  const { t } = useI18n();
  const reply = entry.reply;
  return (
    <article className="assistant-exchange">
      <p className="assistant-question">{entry.question}</p>
      {entry.error && (
        <div className="assistant-error" role="alert">
          <span>{entry.error}</span>
          <button disabled={sending} onClick={() => onRetry(entry.id)}>
            <RotateCw />
            {t("retry")}
          </button>
        </div>
      )}
      {reply && (
        <div className="assistant-answer">
          <p>{resolveAssistantMessage(reply, t)}</p>
          {!!reply.clarification?.candidates.length && (
            <div className="assistant-broadscope">
              <div className="assistant-broadscope-actions">
                {reply.clarification.candidates.map((candidate) => (
                  <button
                    type="button"
                    disabled={sending}
                    key={candidate.id}
                    aria-label={candidate.name}
                    onClick={() =>
                      onSendExplicit(
                        `${t("whichElementDoYouMean")} ${candidate.name} [${candidate.id}]`,
                      )
                    }
                  >
                    {t("useExistingElement", { name: candidate.name })}
                  </button>
                ))}
              </div>
            </div>
          )}
          {reply.broadScope && (
            <div className="assistant-broadscope">
              <div className="assistant-broadscope-actions">
                <button type="button" onClick={onOpenChapterPicker}>
                  {t("pickChaptersIndividually")}
                </button>
                <button type="button" disabled={sending} onClick={() => onRunBatch(entry.id)}>
                  {t("runInChapterGroups")}
                </button>
              </div>
            </div>
          )}
          {!!reply.sources?.length && (
            <SourceList sources={reply.sources} onNavigate={onNavigate} />
          )}
          {!!reply.proposals?.length && (
            <ProposalList
              entryId={entry.id}
              reply={reply}
              appliedIndices={entry.applied}
              figures={figures}
              dismissedIndices={entry.dismissed || []}
              proposalEdits={entry.proposalEdits || {}}
              claimStatuses={entry.claimStatuses || {}}
              onNavigate={onNavigate}
              onApply={onApply}
              onDismiss={onDismiss}
              onEdit={onEdit}
              onClassifyClaim={onClassifyClaim}
            />
          )}
          {!!reply.agentTrace?.length && (
            <details className="assistant-trace">
              <summary>
                <ChevronDown />
                {t("agentTraceSteps").replace("{n}", String(reply.agentTrace.length))}
              </summary>
              <pre>{JSON.stringify(reply.agentTrace, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
    </article>
  );
}

function SourceList({
  sources,
  onNavigate,
}: {
  sources: AssistantSource[];
  onNavigate: (target: { workspace: Workspace; id: string }) => void;
}) {
  const { t } = useI18n();
  return (
    <details className="assistant-sources">
      <summary>
        <ChevronDown />
        {t("sources")} · {sources.length}
      </summary>
      <div>
        {sources.map((source) => (
          <button key={source.id} title={source.text} onClick={() => onNavigate(source.target)}>
            {source.title}
          </button>
        ))}
      </div>
    </details>
  );
}

function ProposalList({
  entryId,
  reply,
  appliedIndices,
  figures,
  dismissedIndices,
  proposalEdits,
  claimStatuses,
  onNavigate,
  onApply,
  onDismiss,
  onEdit,
  onClassifyClaim,
}: {
  entryId: string;
  reply: AssistantReply;
  appliedIndices: number[];
  figures: FigureState;
  dismissedIndices: number[];
  proposalEdits: Record<number, AssistantProposal>;
  claimStatuses: Record<number, AssistantClaimStatus>;
  onNavigate: (target: { workspace: Workspace; id: string }) => void;
  onApply: (entryId: string, proposals: AssistantProposal[], indices: number[]) => void;
  onDismiss: (entryId: string, index: number) => void;
  onEdit: (entryId: string, index: number, proposal: AssistantProposal) => void;
  onClassifyClaim: (entryId: string, index: number, claimStatus: AssistantClaimStatus) => void;
}) {
  const { t } = useI18n();
  const proposals = reply.proposals;
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const groups = reply.proposalGroups?.length
    ? reply.proposalGroups
    : [{ id: "all", proposalIndexes: proposals.map((_proposal, index) => index) }];
  const effective = (index: number) => proposalEdits[index] || proposals[index];
  const extraction = reply.mode === "world_extraction";
  const claimStatus = (index: number): AssistantClaimStatus =>
    claimStatuses[index] || reply.proposalEnvelopes?.[index]?.claimStatus || "unresolved";
  const pending = (indices: number[]) =>
    indices.filter((index) => !appliedIndices.includes(index) && !dismissedIndices.includes(index));
  const applicable = (indices: number[]) =>
    pending(indices).filter((index) => !extraction || claimStatus(index) === "objective_fact");
  const groupTitle = (id: string) => {
    if (id === "elements") return t("proposalGroupElements");
    if (id === "updates") return t("proposalGroupUpdates");
    if (id === "relationships") return t("proposalGroupRelationships");
    if (id === "timeline") return t("proposalGroupTimeline");
    if (id === "presence") return t("proposalGroupPresence");
    return "";
  };
  const allPending = applicable(proposals.map((_proposal, index) => index));
  return (
    <details className="assistant-proposals" open>
      <summary className="assistant-proposal-heading">
        <span>
          <ChevronDown />
          <strong>{t("nProposals").replace("{n}", String(proposals.length))}</strong>
        </span>
        <button
          disabled={!allPending.length}
          onClick={(event) => {
            event.preventDefault();
            onApply(entryId, allPending.map(effective), allPending);
          }}
        >
          <Check />
          {t("applyAll")}
        </button>
      </summary>
      {groups.map((group) => {
        const groupPending = applicable(group.proposalIndexes);
        return (
          <section className="assistant-proposal-group" key={group.id}>
            {group.id !== "all" && (
              <header>
                <strong>{groupTitle(group.id)}</strong>
                <button
                  type="button"
                  disabled={!groupPending.length}
                  onClick={() => onApply(entryId, groupPending.map(effective), groupPending)}
                >
                  <Check />
                  {t("applyGroup")}
                </button>
              </header>
            )}
            {group.proposalIndexes.map((index) => {
              const proposal = effective(index);
              const grouped = (reply.proposalGroup?.proposalIndexes.length || 0) > 1;
              const applied = appliedIndices.includes(index);
              const dismissed = dismissedIndices.includes(index);
              const envelope = reply.proposalEnvelopes?.[index];
              const canApply = !extraction || claimStatus(index) === "objective_fact";
              return (
                <div
                  className={`assistant-proposal ${applied ? "is-applied" : ""} ${dismissed ? "is-dismissed" : ""}`}
                  key={index}
                >
                  <div className="assistant-proposal-content">
                    <span>{proposalLabel(proposal, figures, t)}</span>
                    {envelope?.resolution && (
                      <small>
                        {t("proposalResolution", { outcome: envelope.resolution.outcome })}
                      </small>
                    )}
                    {!!envelope?.evidence.length && (
                      <details className="assistant-proposal-evidence">
                        <summary>
                          {t("proposalEvidence")} · {envelope.evidence.length}
                        </summary>
                        <div>
                          {envelope.evidence.map((source) => (
                            <button
                              type="button"
                              key={source.id}
                              title={source.text}
                              onClick={() => onNavigate(source.target)}
                            >
                              {source.title}
                            </button>
                          ))}
                        </div>
                      </details>
                    )}
                    {extraction && !applied && !dismissed && (
                      <div className="assistant-claim-review">
                        <span>{t("claimStatusLabel")}</span>
                        <SelectControl
                          label={t("claimStatusLabel")}
                          value={claimStatus(index)}
                          options={[
                            { value: "unresolved", label: t("claimUnresolved") },
                            { value: "objective_fact", label: t("claimObjectiveFact") },
                            { value: "narrator_claim", label: t("claimNarrator") },
                            { value: "character_knows", label: t("claimCharacterKnows") },
                            {
                              value: "character_believes",
                              label: t("claimCharacterBelieves"),
                            },
                            { value: "character_claims", label: t("claimCharacterClaims") },
                          ]}
                          onChange={(status) => onClassifyClaim(entryId, index, status)}
                        />
                        {!canApply && claimStatus(index) !== "unresolved" && (
                          <small>{t("claimNotCanonHint")}</small>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="assistant-proposal-actions">
                    {!applied && !dismissed && !grouped && (
                      <>
                        <button type="button" onClick={() => setEditingIndex(index)}>
                          <Pencil />
                          {t("editProposal")}
                        </button>
                        <button type="button" onClick={() => onDismiss(entryId, index)}>
                          <EyeOff />
                          {t("ignoreProposal")}
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      disabled={applied || dismissed || grouped || !canApply}
                      title={
                        !canApply
                          ? t("classifyObjectiveBeforeApply")
                          : grouped
                            ? t("packageOnlyTogetherHelp")
                            : undefined
                      }
                      onClick={() => onApply(entryId, [proposal], [index])}
                    >
                      {applied ? (
                        <>
                          <Check />
                          {t("applied")}
                        </>
                      ) : dismissed ? (
                        t("ignoredProposal")
                      ) : grouped ? (
                        t("inPackage")
                      ) : (
                        t("apply")
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
      {editingIndex !== null && (
        <AssistantProposalEditor
          proposal={effective(editingIndex)}
          figures={figures}
          onSave={(proposal) => onEdit(entryId, editingIndex, proposal)}
          onClose={() => setEditingIndex(null)}
        />
      )}
    </details>
  );
}
