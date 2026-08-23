import { useEffect, useId, useRef, useState } from "react";
import { BookOpenCheck, Plus, Sparkles, X } from "lucide-react";
import type { Workspace } from "../../shared";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { Inspector } from "../../shared/ui/Sidebar";
import { Sheet } from "../../shared/ui/Sheet";
import { SelectControl } from "../../shared/ui/SelectControl";
import { useI18n } from "../../i18n";
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
  onClose,
}: {
  worldId: string;
  figures: FigureState;
  chapters: Chapter[];
  currentChapterId: string;
  open: boolean;
  onApply: (proposals: AssistantProposal[]) => void;
  onNavigate: (target: { workspace: Workspace; id: string }) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const installProgressId = useId();
  const batchProgressId = useId();
  const [draft, setDraft] = useState("");
  const [confirmNewChat, setConfirmNewChat] = useState(false);
  const [forcedChapterIds, setForcedChapterIds] = useState<string[]>([]);
  const [extractionScope, setExtractionScope] = useState<"current" | "selected" | "all">("current");
  const [compact, setCompact] = useState(
    () => typeof matchMedia === "function" && matchMedia("(max-width: 719px)").matches,
  );
  const endRef = useRef<HTMLDivElement>(null);
  const chapterPickerRef = useRef<HTMLDetailsElement>(null);
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
    t,
  });

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

  const openChapterPicker = () => {
    const picker = chapterPickerRef.current;
    if (!picker) return;
    picker.open = true;
    picker.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
          <button
            className="icon-button"
            disabled={!entries.length || sending}
            aria-label={t("newChat")}
            title={t("newChat")}
            onClick={() => setConfirmNewChat(true)}
          >
            <Plus />
          </button>
          <button className="icon-button" aria-label={t("closeAssistant")} onClick={onClose}>
            <X />
          </button>
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
          <button
            type="button"
            disabled={
              sending ||
              status?.available === false ||
              chapters.length === 0 ||
              (extractionScope === "current" && !currentChapterId)
            }
            onClick={updateWorldFromManuscript}
          >
            <BookOpenCheck aria-hidden="true" />
            <span>{t("updateWorldFromManuscript")}</span>
          </button>
          <SelectControl
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
    <Sheet open={open} label={t("localAssistant")} onClose={onClose}>
      <div className={className}>{content}</div>
    </Sheet>
  ) : open ? (
    <Inspector className={className} aria-label={t("localAssistant")}>
      {content}
    </Inspector>
  ) : null;
}
