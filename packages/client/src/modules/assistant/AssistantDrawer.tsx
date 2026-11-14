import { BookOpenCheck, Plus, Sparkles, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button, ConfirmDialog, IconButton, ListboxSelect, Sheet, SidePanel } from "../../design";
import { useI18n } from "../../i18n";
import type { Workspace } from "../../shared";
import { useUserCapabilities } from "../../shared/capabilities";
import { type Chapter, isChapterInBook } from "../manuscript";
import type { FigureState } from "../story-world";
import { AssistantComposer } from "./AssistantComposer";
import { AssistantConversation } from "./AssistantConversation";
import { AssistantProposalEditor } from "./AssistantProposalEditor";
import { AssistantStatusPanel } from "./AssistantStatusPanel";
import { useEngineChoice } from "./engines/useEngineChoice";
import type { AssistantProposal } from "./model";
import type { AssistantProposalApplyResult } from "./proposals";
import { useAssistantAvailability } from "./useAssistantAvailability";
import { useAssistantConversation } from "./useAssistantConversation";
import "./AssistantDrawer.css";

export function AssistantDrawer({
  worldId,
  accountSub,
  figures,
  chapters,
  chapterStatuses,
  currentChapterId,
  open,
  onApply,
  onNavigate,
  onBeforeSend,
  onClose,
}: {
  worldId: string;
  /** The signed-in account on a shared server; binds the assistant history to it (S269-6). */
  accountSub?: string;
  figures: FigureState;
  chapters: Chapter[];
  chapterStatuses?: ReadonlyMap<string, "set_aside" | "deleted">;
  currentChapterId: string;
  open: boolean;
  onApply: (proposals: AssistantProposal[]) => AssistantProposalApplyResult;
  onNavigate: (target: { workspace: Workspace; id: string }) => void;
  onBeforeSend: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const installProgressId = useId();
  const batchProgressId = useId();
  const [draft, setDraft] = useState("");
  const [confirmNewChat, setConfirmNewChat] = useState(false);
  const [forcedChapterIds, setForcedChapterIds] = useState<string[]>([]);
  const [chapterPickerOpen, setChapterPickerOpen] = useState(false);
  const [extractionScope, setExtractionScope] = useState<"current" | "selected" | "all">("current");
  // Held here rather than in the proposal list: a compact/regular switch remounts `content`.
  const [proposalEdit, setProposalEdit] = useState<{
    entryId: string;
    index: number;
    draft: AssistantProposal;
  } | null>(null);
  const [compact, setCompact] = useState(
    () => typeof matchMedia === "function" && matchMedia("(max-width: 719px)").matches,
  );
  const endRef = useRef<HTMLDivElement>(null);
  const chapterPickerRef = useRef<HTMLButtonElement>(null);
  const { status, installState, checkStatus, startInstall } = useAssistantAvailability(open);
  // One choice for the drawer and its status panel, so a switch of engine re-renders both.
  const engineChoice = useEngineChoice(status?.premium !== false);
  // The server's assistant locks the composer only while a job would run there: without a
  // runtime, or without the premium role, which the server enforces with a 403 (D-40). The
  // effective engine falls back to the server when nothing is offered, so that case locks too.
  // A browser engine works without either (T-61 part 6, D-T-61-8a-F2).
  const serverAi = useUserCapabilities().serverAi ?? status?.premium !== false;
  const serverOffline =
    engineChoice.engine === "server" && (status?.available === false || !serverAi);
  const {
    entries,
    sending,
    batchProgress,
    send,
    cancel,
    apply,
    dismiss,
    edit,
    classifyClaim,
    clear,
  } = useAssistantConversation({
    worldId,
    accountSub,
    forcedChapterIds,
    onApply,
    onBeforeSend,
    t,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: New entries intentionally trigger scrolling to the ref target.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const media = matchMedia("(max-width: 719px)");
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // Closing the assistant discards an open chapter picker and, as it did before the edit
  // moved up here, an open proposal edit.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setChapterPickerOpen(false);
      setProposalEdit(null);
    }
  }

  const openChapterPicker = () => {
    setChapterPickerOpen(true);
    chapterPickerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  const currentChapter = chapters.find((chapter) => chapter.id === currentChapterId);
  const currentScopeLabel = `${t("currentChapterScope")}${
    currentChapter && !isChapterInBook(currentChapter) ? ` · ${t("chapterSetAsideStatus")}` : ""
  }`;

  const sendDraft = () => {
    const question = draft.trim();
    if (!question) return;
    setDraft("");
    void send(undefined, undefined, question);
  };

  const updateWorldFromManuscript = () => {
    if (extractionScope === "selected" && !forcedChapterIds.length) {
      openChapterPicker();
      return;
    }
    const chapterIds =
      extractionScope === "all"
        ? []
        : extractionScope === "current"
          ? [currentChapterId]
          : forcedChapterIds;
    void send(
      undefined,
      { mode: "world_extraction", chapterIds },
      t("updateWorldFromManuscriptRequest"),
    );
  };

  const content = (
    <>
      <header>
        <div>
          <Sparkles />
          <span>
            <strong>{t("assistant")}</strong>
            <small>{t("localOnlySuggestions")}</small>
          </span>
        </div>
        <div className="assistant-header-actions">
          <IconButton
            label={t("newChat")}
            icon={<Plus />}
            disabled={!entries.length || sending}
            title={t("newChat")}
            onClick={() => setConfirmNewChat(true)}
          />
          <IconButton label={t("closeAssistant")} icon={<X />} onClick={onClose} />
        </div>
      </header>
      <AssistantStatusPanel
        status={status}
        choice={engineChoice}
        installState={installState}
        installProgressId={installProgressId}
        onRetry={checkStatus}
        onInstall={startInstall}
      />
      <section className="assistant-world-update" aria-label={t("updateWorldFromManuscript")}>
        <div>
          <Button
            className="assistant-world-update-button"
            appearance="secondary"
            icon={<BookOpenCheck />}
            disabled={
              sending ||
              serverOffline ||
              chapters.length === 0 ||
              (extractionScope === "current" && !currentChapterId)
            }
            onClick={updateWorldFromManuscript}
          >
            {t("updateWorldFromManuscript")}
          </Button>
          <ListboxSelect
            label={t("worldUpdateScope")}
            value={extractionScope}
            options={[
              {
                value: "current",
                label: currentScopeLabel,
                disabled: !currentChapterId,
              },
              { value: "selected", label: t("selectedChaptersScope") },
              { value: "all", label: t("allChaptersScope") },
            ]}
            onChange={setExtractionScope}
          />
        </div>
        <small>
          {t("updateWorldFromManuscriptHint", {
            scope:
              extractionScope === "current"
                ? currentScopeLabel
                : t(extractionScope === "selected" ? "selectedChaptersScope" : "allChaptersScope"),
          })}
        </small>
      </section>
      <AssistantConversation
        entries={entries}
        sending={sending}
        batchProgress={batchProgress}
        batchProgressId={batchProgressId}
        figures={figures}
        chapterStatuses={chapterStatuses}
        endRef={endRef}
        onDraftChange={setDraft}
        onRetry={(entryId) => void send(entryId)}
        onSendExplicit={(question) => void send(undefined, undefined, question)}
        onRunBatch={(entryId) => void send(entryId, { batch: true })}
        onOpenChapterPicker={openChapterPicker}
        onNavigate={onNavigate}
        onApply={apply}
        onDismiss={dismiss}
        onStartEdit={(entryId, index, proposal) =>
          setProposalEdit({ entryId, index, draft: structuredClone(proposal) })
        }
        onClassifyClaim={classifyClaim}
      />
      {proposalEdit && entries.some((entry) => entry.id === proposalEdit.entryId) && (
        <AssistantProposalEditor
          draft={proposalEdit.draft}
          figures={figures}
          insideSheet={compact}
          onDraftChange={(draft) => setProposalEdit((current) => current && { ...current, draft })}
          onSave={(proposal) => edit(proposalEdit.entryId, proposalEdit.index, proposal)}
          onClose={() => setProposalEdit(null)}
        />
      )}
      <AssistantComposer
        chapters={chapters}
        forcedChapterIds={forcedChapterIds}
        onForcedChapterIdsChange={setForcedChapterIds}
        chapterPickerRef={chapterPickerRef}
        chapterPickerOpen={chapterPickerOpen}
        onChapterPickerOpenChange={setChapterPickerOpen}
        draft={draft}
        onDraftChange={setDraft}
        sending={sending}
        unavailable={serverOffline}
        onSend={sendDraft}
        onCancel={cancel}
      />
      {confirmNewChat && (
        <ConfirmDialog
          title={t("newChat")}
          description={t("newChatConfirmDescription")}
          closeLabel={t("closeDialog")}
          cancelLabel={t("cancel")}
          confirmLabel={t("startNewChat")}
          onConfirm={clear}
          onClose={() => setConfirmNewChat(false)}
        />
      )}
    </>
  );

  const className = `assistant-drawer ${serverOffline ? "has-offline" : ""}`;
  // The component remains mounted while closed so requests and install polling survive.
  return compact ? (
    <Sheet
      open={open}
      label={t("localAssistant")}
      className="assistant-drawer-sheet"
      onClose={onClose}
    >
      <div className={className}>{content}</div>
    </Sheet>
  ) : open ? (
    <SidePanel className={className} label={t("localAssistant")}>
      {content}
    </SidePanel>
  ) : null;
}
