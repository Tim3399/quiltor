import { Copy, Search } from "lucide-react";
import {
  Alert,
  Button,
  ChipAction,
  ChipList,
  EmptyState,
  IconButton,
  ProgressBar,
  SegmentedControl,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TextField,
} from "../../design";
import { useI18n } from "../../i18n";
import {
  quiltorClient,
  type WritingAssistanceLookupResult,
  type WritingAssistanceStatus,
} from "../../platform";
import type { AssistancePhase, WritingLocale } from "./WritingAidInspector.types";
import { WritingTabScroller } from "./WritingTabScroller";
import type { WritingTool } from "./workspaceTypes";

const WRITING_TOOLS: WritingTool[] = ["lookup", "synonyms", "translate"];

export interface WritingLookupPanelProps {
  selectionTool: WritingTool;
  writingLocale: WritingLocale;
  writingQuery: string;
  status: WritingAssistanceStatus | null;
  results: WritingAssistanceLookupResult[];
  phase: AssistancePhase;
  replaceTarget: boolean;
  lookupSources: string[];
  onWritingQuery: (value: string) => void;
  onRunLookup: () => void;
  onChooseTool: (tool: WritingTool) => void;
  onLocale: (locale: WritingLocale) => void;
  onInstallData: () => void;
  onApplyValue: (value: string) => void;
}

export function WritingLookupPanel({
  selectionTool,
  writingLocale,
  writingQuery,
  status,
  results,
  phase,
  replaceTarget,
  lookupSources,
  onWritingQuery,
  onRunLookup,
  onChooseTool,
  onLocale,
  onInstallData,
  onApplyValue,
}: WritingLookupPanelProps) {
  const { t } = useI18n();
  const toolLabel = (tool: WritingTool) =>
    tool === "lookup" ? t("dictionary") : tool === "synonyms" ? t("synonyms") : t("translate");
  const resultValues = (result: WritingAssistanceLookupResult) =>
    result.values.length ? result.values : [result.lemma];

  return (
    <div className="writing-lookup">
      <form
        className="writing-search"
        onSubmit={(event) => {
          event.preventDefault();
          onRunLookup();
        }}
      >
        <TextField
          fieldClassName="writing-search-field"
          label={t("searchTerm")}
          labelHidden
          value={writingQuery}
          onChange={(event) => onWritingQuery(event.target.value)}
          placeholder={t("writingSearchPlaceholder")}
        />
        <IconButton
          className="writing-search__submit"
          type="submit"
          label={t("lookup")}
          icon={<Search />}
          disabled={!writingQuery.trim()}
          loading={phase === "loading"}
          loadingLabel={t("writingSearching")}
        />
      </form>
      <Tabs
        className="writing-tool-tabs"
        value={selectionTool}
        onValueChange={(value) => onChooseTool(value as WritingTool)}
      >
        <WritingTabScroller className="writing-tool-tabs__scroll" selectedValue={selectionTool}>
          <TabList className="writing-tool-tabs__list" label={t("lookupSources")}>
            {WRITING_TOOLS.map((tool) => (
              <Tab className="writing-tool-tab" key={tool} value={tool}>
                {toolLabel(tool)}
              </Tab>
            ))}
          </TabList>
        </WritingTabScroller>
        <TabPanel className="writing-tool-tabs__panel" value={selectionTool}>
          {selectionTool === "translate" && (
            <SegmentedControl
              className="writing-translation-direction"
              label={t("translationDirection")}
              value={writingLocale}
              options={[
                { value: "de-DE", label: t("germanToEnglish") },
                { value: "en-GB", label: t("englishToGerman") },
              ]}
              onChange={onLocale}
            />
          )}
          {phase === "error" ? (
            <Alert tone="danger">{t("writingRequestError")}</Alert>
          ) : !status?.installed ? (
            <EmptyState
              className="writing-data-state"
              title={t("writingDataMissing")}
              headingLevel={3}
              size="compact"
              actions={
                <Button
                  onClick={onInstallData}
                  loading={phase === "installing"}
                  loadingLabel={t("writingDataInstalling")}
                >
                  {phase === "installing" ? t("writingDataInstalling") : t("writingDataInstall")}
                </Button>
              }
            >
              {phase === "installing" && <ProgressBar label={t("writingDataInstalling")} />}
            </EmptyState>
          ) : phase === "loading" ? (
            <ProgressBar label={t("writingSearching")} />
          ) : results.length ? (
            <div className="writing-results">
              <p className="writing-apply-hint" role="status">
                {replaceTarget ? t("valueReplacesSelection") : t("valueInsertsAtCursor")}
              </p>
              {results.map((result) => (
                <article key={`${result.source}-${result.lemma}-${result.values.join("|")}`}>
                  <header>
                    <strong>{result.lemma}</strong>
                    {result.partOfSpeech && (
                      <span className="writing-result__part-of-speech">{result.partOfSpeech}</span>
                    )}
                    <IconButton
                      className="writing-result__copy"
                      label={t("writingCopy").replace("{word}", result.lemma)}
                      icon={<Copy />}
                      onClick={() =>
                        void quiltorClient.platform.clipboard.writeText(resultValues(result)[0])
                      }
                    />
                  </header>
                  {result.meaning && <p>{result.meaning}</p>}
                  <ChipList className="writing-values" label={result.lemma}>
                    {resultValues(result).map((value) => (
                      <ChipAction
                        className="writing-value"
                        key={value}
                        onClick={() => onApplyValue(value)}
                      >
                        {value}
                      </ChipAction>
                    ))}
                  </ChipList>
                </article>
              ))}
              <footer className="writing-attribution">
                <span>{t("writingAttribution")}</span>
                <ul>
                  {lookupSources.map((source) => (
                    <li key={source}>
                      {status.sources[source]?.attribution || source} ·{" "}
                      {status.sources[source]?.license}
                    </li>
                  ))}
                </ul>
              </footer>
            </div>
          ) : writingQuery.trim() ? (
            <EmptyState title={t("writingNoResults")} headingLevel={3} size="compact" />
          ) : (
            <EmptyState title={t("lookupEmptyHint")} headingLevel={3} size="compact">
              {t("selectionMenuHint")}
            </EmptyState>
          )}
        </TabPanel>
      </Tabs>
    </div>
  );
}
