import { BookOpenCheck, Plus, Sparkles, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button, ConfirmDialog, IconButton, ListboxSelect, Sheet, SidePanel } from "../../design";
import { useI18n } from "../../i18n";
import type { Workspace } from "../../shared";
import type { Chapter } from "../manuscript";
import type { FigureState } from "../story-world";
import { AssistantComposer } from "./AssistantComposer";
import { AssistantConversation } from "./AssistantConversation";
import { AssistantStatusPanel } from "./AssistantStatusPanel";
import type { AssistantProposal } from "./model";
import { useAssistantAvailability } from "./useAssistantAvailability";
import { useAssistantConversation } from "./useAssistantConversation";
import "./AssistantDrawer.css";

export function AssistantDrawer({
  worldId,
  figures,
  chapters,
  currentChapterId,
  open,
  onApply,
  onNavigate,
  onBeforeSend,
  onClose,
}: {
  worldId: string;
  figures: FigureState;
  chapters: Chapter[];
  currentChapterId: string;
  open: boolean;
  onApply: (proposals: AssistantProposal[]) => void;
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
  const [compact, setCompact] = useState(
    () => typeof matchMedia === "function" && matchMedia("(max-width: 719px)").matches,
  );
  const endRef = useRef<HTMLDivElement>(null);
  const chapterPickerRef = useRef<HTMLButtonElement>(null);
  const { status, installState, checkStatus, startInstall } = useAssistantAvailability();
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

  useEffect(() => {
    if (!open) setChapterPickerOpen(false);
  }, [open]);

  const openChapterPicker = () => {
    setChapterPickerOpen(true);
    chapterPickerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

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
              status?.available === false ||
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
                label: t("currentChapterScope"),
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
            scope: t(
              extractionScope === "current"
                ? "currentChapterScope"
                : extractionScope === "selected"
                  ? "selectedChaptersScope"
                  : "allChaptersScope",
            ),
          })}
        </small>
      </section>
      <AssistantConversation
        entries={entries}
        sending={sending}
        batchProgress={batchProgress}
        batchProgressId={batchProgressId}
        figures={figures}
        endRef={endRef}
        onDraftChange={setDraft}
        onRetry={(entryId) => void send(entryId)}
        onSendExplicit={(question) => void send(undefined, undefined, question)}
        onRunBatch={(entryId) => void send(entryId, { batch: true })}
        onOpenChapterPicker={openChapterPicker}
        onNavigate={onNavigate}
        onApply={apply}
        onDismiss={dismiss}
        onEdit={edit}
        onClassifyClaim={classifyClaim}
      />
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
        unavailable={status?.available === false}
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

  const className = `assistant-drawer ${status && !status.available ? "has-offline" : ""}`;
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
