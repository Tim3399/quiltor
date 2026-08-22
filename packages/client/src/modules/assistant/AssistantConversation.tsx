import type { RefObject } from "react";
import { Bot, Check, ChevronDown, RotateCw } from "lucide-react";
import { useI18n } from "../../i18n";
import type { Workspace } from "../../shared";
import type { FigureState } from "../story-world";
import type { AssistantBatchProgress, AssistantEntry } from "./conversationTypes";
import { resolveAssistantMessage } from "./formatting";
import type { AssistantProposal, AssistantReply, AssistantSource } from "./model";
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
                    onClick={() =>
                      onSendExplicit(
                        `${t("whichElementDoYouMean")} ${candidate.name} [${candidate.id}]`,
                      )
                    }
                  >
                    {candidate.name}
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
              onApply={onApply}
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
  onApply,
}: {
  entryId: string;
  reply: AssistantReply;
  appliedIndices: number[];
  figures: FigureState;
  onApply: (entryId: string, proposals: AssistantProposal[], indices: number[]) => void;
}) {
  const { t } = useI18n();
  const proposals = reply.proposals;
  return (
    <details className="assistant-proposals" open>
      <summary className="assistant-proposal-heading">
        <span>
          <ChevronDown />
          <strong>{t("nProposals").replace("{n}", String(proposals.length))}</strong>
        </span>
        <button
          disabled={appliedIndices.length === proposals.length}
          onClick={(event) => {
            event.preventDefault();
            const pending = proposals
              .map((proposal, index) => ({ proposal, index }))
              .filter((item) => !appliedIndices.includes(item.index));
            onApply(
              entryId,
              pending.map((item) => item.proposal),
              pending.map((item) => item.index),
            );
          }}
        >
          <Check />
          {t("applyAll")}
        </button>
      </summary>
      {proposals.map((proposal, index) => {
        const grouped = (reply.proposalGroup?.proposalIndexes.length || 0) > 1;
        const applied = appliedIndices.includes(index);
        return (
          <div className={`assistant-proposal ${applied ? "is-applied" : ""}`} key={index}>
            <span>{proposalLabel(proposal, figures, t)}</span>
            <button
              disabled={applied || grouped}
              title={grouped ? t("packageOnlyTogetherHelp") : undefined}
              onClick={() => onApply(entryId, [proposal], [index])}
            >
              {applied ? (
                <>
                  <Check />
                  {t("applied")}
                </>
              ) : grouped ? (
                t("inPackage")
              ) : (
                t("apply")
              )}
            </button>
          </div>
        );
      })}
    </details>
  );
}
