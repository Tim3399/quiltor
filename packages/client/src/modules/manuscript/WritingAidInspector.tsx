import { RotateCw } from "lucide-react";
import { Alert, Button, SidePanelBody, Tab, TabList, TabPanel, Tabs } from "../../design";
import { useI18n } from "../../i18n";
import { GrammarInspectorPanel } from "./GrammarInspectorPanel";
import type { WritingAidInspectorProps } from "./WritingAidInspector.types";
import { WritingInsertPanel } from "./WritingInsertPanel";
import { WritingLookupPanel } from "./WritingLookupPanel";
import { WritingTabScroller } from "./WritingTabScroller";
import type { HelperMode } from "./workspaceTypes";
import "./WritingAidInspector.css";

export function WritingAidInspector({
  current,
  manuscript,
  figures,
  orphanedMentions,
  helperModes,
  activeMode,
  onMode,
  selectionTool,
  writingLocale,
  writingQuery,
  onWritingQuery,
  status,
  results,
  assistancePhase,
  lookupError,
  statusFailed,
  onRetryStatus,
  replaceTarget,
  grammarIssues,
  selectedIssue,
  grammarPhase,
  grammarError,
  ambiguousMentions,
  symbolPicker,
  onSymbolPicker,
  onRunLookup,
  onChooseTool,
  onLocale,
  onInstallData,
  onApplyValue,
  onCheckGrammar,
  onInstallGrammar,
  onSelectIssue,
  onApplyIssue,
  onGrammarMode,
  onInsertEntity,
  onResolveAmbiguous,
  onManageTerms,
  onManageElements,
  onInsert,
  onToggleSymbol,
}: WritingAidInspectorProps) {
  const { t } = useI18n();
  const modeLabel = (mode: HelperMode) =>
    mode === "lookup" ? t("helperLookup") : mode === "check" ? t("helperCheck") : t("helperInsert");

  return (
    <SidePanelBody className="helper-panel">
      <Tabs
        className="writing-aid-tabs"
        value={activeMode}
        onValueChange={(value) => onMode(value as HelperMode)}
      >
        <WritingTabScroller className="writing-aid-mode-scroll" selectedValue={activeMode}>
          <TabList className="helper-modes" label={t("writingAidSection")}>
            {helperModes.map((mode) => (
              <Tab className="helper-mode-tab" key={mode} value={mode}>
                {modeLabel(mode)}
              </Tab>
            ))}
          </TabList>
        </WritingTabScroller>
        <TabPanel className="writing-aid-tabs__panel" value={activeMode}>
          {statusFailed && activeMode !== "insert" ? (
            <Alert className="writing-status-error" tone="danger" title={t("writingStatusError")}>
              <Button size="compact" icon={<RotateCw />} onClick={onRetryStatus}>
                {t("retry")}
              </Button>
            </Alert>
          ) : activeMode === "lookup" ? (
            <WritingLookupPanel
              selectionTool={selectionTool}
              writingLocale={writingLocale}
              writingQuery={writingQuery}
              status={status}
              results={results}
              phase={assistancePhase}
              errorMessage={lookupError}
              replaceTarget={replaceTarget}
              onWritingQuery={onWritingQuery}
              onRunLookup={onRunLookup}
              onChooseTool={onChooseTool}
              onLocale={onLocale}
              onInstallData={onInstallData}
              onApplyValue={onApplyValue}
            />
          ) : activeMode === "check" ? (
            <GrammarInspectorPanel
              current={current}
              manuscript={manuscript}
              status={status}
              issues={grammarIssues}
              selectedIssue={selectedIssue}
              phase={grammarPhase}
              errorMessage={grammarError}
              onCheck={onCheckGrammar}
              onInstall={onInstallGrammar}
              onSelectIssue={onSelectIssue}
              onApplyIssue={onApplyIssue}
              onGrammarMode={onGrammarMode}
            />
          ) : (
            <WritingInsertPanel
              manuscript={manuscript}
              figures={figures}
              orphanedMentions={orphanedMentions}
              ambiguousMentions={ambiguousMentions}
              symbolPicker={symbolPicker}
              onSymbolPicker={onSymbolPicker}
              onInsertEntity={onInsertEntity}
              onResolveAmbiguous={onResolveAmbiguous}
              onManageTerms={onManageTerms}
              onManageElements={onManageElements}
              onInsert={onInsert}
              onToggleSymbol={onToggleSymbol}
            />
          )}
        </TabPanel>
      </Tabs>
    </SidePanelBody>
  );
}
