import { Bot, Check, EyeOff, Pencil, RotateCw } from "lucide-react";
import { type RefObject, useState } from "react";
import {
  Alert,
  Button,
  ChipAction,
  ChipList,
  Disclosure,
  EmptyState,
  ListboxSelect,
  ProgressBar,
} from "../../design";
import { useI18n } from "../../i18n";
import type { Workspace } from "../../shared";
import type { FigureState } from "../story-world";
import { AssistantProposalEditor } from "./AssistantProposalEditor";
import type { AssistantBatchProgress, AssistantEntry } from "./conversationTypes";
import { resolveAssistantMessage } from "./formatting";
import type {
  AssistantClaimStatus,
  AssistantProposal,
  AssistantReply,
  AssistantSource,
} from "./model";
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
        <EmptyState
          className="assistant-empty"
          icon={<Bot />}
          title={t("assistantGreeting")}
          actions={
            <>
              <Button onClick={() => onDraftChange(t("findMissingFiguresPrompt"))}>
                {t("findMissingFigures")}
              </Button>
              <Button onClick={() => onDraftChange(t("checkTimelinePrompt"))}>
                {t("checkTimeline")}
              </Button>
            </>
          }
        >
          <p>{t("assistantGreetingBody")}</p>
        </EmptyState>
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
        <ProgressBar
          id={batchProgressId}
          className="assistant-progress"
          label={`${
            batchProgress.labelKey
              ? t(batchProgress.labelKey, batchProgress.labelParams)
              : t("processingChapterGroups")
          }${batchProgress.total ? ` (${batchProgress.done}/${batchProgress.total})` : ""}`}
          value={batchProgress.total ? batchProgress.done : undefined}
          max={batchProgress.total || undefined}
          valueLabel={
            batchProgress.total ? `${batchProgress.done}/${batchProgress.total}` : undefined
          }
          showValue
        />
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
        <Alert
          className="assistant-error"
          tone="danger"
          action={
            <Button
              appearance="ghost"
              tone="danger"
              size="compact"
              disabled={sending}
              icon={<RotateCw />}
              onClick={() => onRetry(entry.id)}
            >
              {t("retry")}
            </Button>
          }
        >
          {entry.error}
        </Alert>
      )}
      {reply && (
        <div className="assistant-answer">
          <p>{resolveAssistantMessage(reply, t)}</p>
          {!!reply.clarification?.candidates.length && (
            <div className="assistant-broadscope">
              <div className="assistant-broadscope-actions">
                {reply.clarification.candidates.map((candidate) => (
                  <Button
                    className="assistant-broadscope-action"
                    size="compact"
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
                  </Button>
                ))}
              </div>
            </div>
          )}
          {reply.broadScope && (
            <div className="assistant-broadscope">
              <div className="assistant-broadscope-actions">
                <Button
                  className="assistant-broadscope-action"
                  size="compact"
                  onClick={onOpenChapterPicker}
                >
                  {t("pickChaptersIndividually")}
                </Button>
                <Button
                  className="assistant-broadscope-action"
                  size="compact"
                  disabled={sending}
                  onClick={() => onRunBatch(entry.id)}
                >
                  {t("runInChapterGroups")}
                </Button>
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
            <Disclosure
              className="assistant-trace"
              summary={t("agentTraceSteps").replace("{n}", String(reply.agentTrace.length))}
            >
              <pre>{JSON.stringify(reply.agentTrace, null, 2)}</pre>
            </Disclosure>
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
    <Disclosure className="assistant-sources" summary={`${t("sources")} · ${sources.length}`}>
      <ChipList className="assistant-source-list" label={t("sources")}>
        {sources.map((source) => (
          <ChipAction key={source.id} title={source.text} onClick={() => onNavigate(source.target)}>
            {source.title}
          </ChipAction>
        ))}
      </ChipList>
    </Disclosure>
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
    <section className="assistant-proposals">
      <header className="assistant-proposal-heading">
        <span>
          <strong>{t("nProposals").replace("{n}", String(proposals.length))}</strong>
        </span>
        <Button
          appearance="ghost"
          size="compact"
          icon={<Check />}
          disabled={!allPending.length}
          onClick={() => onApply(entryId, allPending.map(effective), allPending)}
        >
          {t("applyAll")}
        </Button>
      </header>
      {groups.map((group) => {
        const groupPending = applicable(group.proposalIndexes);
        return (
          <section className="assistant-proposal-group" key={group.id}>
            {group.id !== "all" && (
              <header>
                <strong>{groupTitle(group.id)}</strong>
                <Button
                  appearance="ghost"
                  size="compact"
                  icon={<Check />}
                  disabled={!groupPending.length}
                  onClick={() => onApply(entryId, groupPending.map(effective), groupPending)}
                >
                  {t("applyGroup")}
                </Button>
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
                      <Disclosure
                        className="assistant-proposal-evidence"
                        summary={`${t("proposalEvidence")} · ${envelope.evidence.length}`}
                      >
                        <ChipList className="assistant-evidence-list" label={t("proposalEvidence")}>
                          {envelope.evidence.map((source) => (
                            <ChipAction
                              key={source.id}
                              title={source.text}
                              onClick={() => onNavigate(source.target)}
                            >
                              {source.title}
                            </ChipAction>
                          ))}
                        </ChipList>
                      </Disclosure>
                    )}
                    {extraction && !applied && !dismissed && (
                      <div className="assistant-claim-review">
                        <span>{t("claimStatusLabel")}</span>
                        <ListboxSelect
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
                        <Button
                          appearance="ghost"
                          size="compact"
                          icon={<Pencil />}
                          onClick={() => setEditingIndex(index)}
                        >
                          {t("editProposal")}
                        </Button>
                        <Button
                          appearance="ghost"
                          size="compact"
                          icon={<EyeOff />}
                          onClick={() => onDismiss(entryId, index)}
                        >
                          {t("ignoreProposal")}
                        </Button>
                      </>
                    )}
                    <Button
                      appearance="ghost"
                      size="compact"
                      icon={applied ? <Check /> : undefined}
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
                      {applied
                        ? t("applied")
                        : dismissed
                          ? t("ignoredProposal")
                          : grouped
                            ? t("inPackage")
                            : t("apply")}
                    </Button>
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
    </section>
  );
}
