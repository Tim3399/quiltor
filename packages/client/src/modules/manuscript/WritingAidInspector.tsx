import { X } from "lucide-react";
import {
  IconButton,
  SidePanelBody,
  SidePanelHeader,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from "../../design";
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
  replaceTarget,
  lookupSources,
  grammarIssues,
  selectedIssue,
  grammarPhase,
  ambiguousMentions,
  symbolPicker,
  onSymbolPicker,
  onClose,
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
  onInsert,
  onToggleSymbol,
}: WritingAidInspectorProps) {
  const { t } = useI18n();
  const modeLabel = (mode: HelperMode) =>
    mode === "lookup" ? t("helperLookup") : mode === "check" ? t("helperCheck") : t("helperInsert");

  return (
    <>
      <SidePanelHeader
        className="writing-aid__header"
        title={t("writingAid")}
        actions={
          <IconButton
            label={t("closeWritingAid")}
            icon={<X />}
            onClick={onClose}
            title={t("closeWritingAid")}
          />
        }
      />
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
            {activeMode === "lookup" ? (
              <WritingLookupPanel
                selectionTool={selectionTool}
                writingLocale={writingLocale}
                writingQuery={writingQuery}
                status={status}
                results={results}
                phase={assistancePhase}
                replaceTarget={replaceTarget}
                lookupSources={lookupSources}
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
                onInsert={onInsert}
                onToggleSymbol={onToggleSymbol}
              />
            )}
          </TabPanel>
        </Tabs>
      </SidePanelBody>
    </>
  );
}
