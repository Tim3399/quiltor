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
  type WritingInstalledSource,
} from "../../platform";
import { installAllowed, useInstanceCapabilities } from "../../shared/capabilities";
import { partOfSpeechLabel } from "./partOfSpeech";
import type { AssistancePhase, WritingLocale } from "./WritingAidInspector.types";
import { WritingTabScroller } from "./WritingTabScroller";
import type { WritingTool } from "./workspaceTypes";

const WRITING_TOOLS: WritingTool[] = ["lookup", "synonyms", "translate"];

/** Only http(s) addresses become links; anything else a data file carries stays text. */
const webAddress = (url: string) => (/^https?:\/\//i.test(url) ? url : null);

function SourceLink({ href, children }: { href: string; children: string }) {
  const target = webAddress(href);
  return target ? (
    <a href={target} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <>{children}</>
  );
}

function InstalledSourceItem({ source }: { source: WritingInstalledSource }) {
  return (
    <li>
      <SourceLink href={source.url}>{source.name}</SourceLink>
      {source.license && (
        <>
          {" · "}
          <SourceLink href={source.licenseUrl}>{source.license}</SourceLink>
        </>
      )}
    </li>
  );
}

/** "12,3 MB"; the download size is shown before anything is fetched. */
function formatMegabytes(bytes: number, locale: string) {
  const megabytes = Math.max(bytes / 1_000_000, 0.1);
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(megabytes)} MB`;
}

export interface WritingLookupPanelProps {
  selectionTool: WritingTool;
  writingLocale: WritingLocale;
  writingQuery: string;
  status: WritingAssistanceStatus | null;
  results: WritingAssistanceLookupResult[];
  phase: AssistancePhase;
  /** Shown while `phase` is "error"; the generic sentence when empty. */
  errorMessage?: string;
  replaceTarget: boolean;
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
  errorMessage,
  replaceTarget,
  onWritingQuery,
  onRunLookup,
  onChooseTool,
  onLocale,
  onInstallData,
  onApplyValue,
}: WritingLookupPanelProps) {
  const { t, locale } = useI18n();
  const capabilities = useInstanceCapabilities();
  const toolLabel = (tool: WritingTool) =>
    tool === "lookup" ? t("dictionary") : tool === "synonyms" ? t("synonyms") : t("translate");
  const resultValues = (result: WritingAssistanceLookupResult) =>
    result.values.length ? result.values : [result.lemma];
  // With only the starter set installed, an empty result usually means "not in
  // the eight sample words", not "no such word" -- say so next to it.
  const coreOnly = status?.installed && status.coverage === "core" && (
    <Alert className="writing-coverage" tone="info" title={t("writingCoreOnly")}>
      {t("writingCoreOnlyHint")}
    </Alert>
  );

  const installedSources = status?.installedSources ?? [];
  const downloadBytes = status?.data?.available ? status.data.bytes : null;
  const stale = status?.stale === true;
  const installLabel = stale ? t("writingDataUpdate") : t("writingDataInstall");
  const installingLabel = stale ? t("writingDataUpdating") : t("writingDataInstalling");
  const downloadSize = downloadBytes ? (
    <p className="writing-data-state__note">
      {t("writingDataSize", { size: formatMegabytes(downloadBytes, locale) })}
    </p>
  ) : null;
  // An installed dictionary of an older layout still answers; offer the update
  // next to the results instead of hiding them behind the missing-data state.
  const staleNote = stale && status?.installed && status.data?.available !== false && (
    <Alert className="writing-coverage" tone="info" title={t("writingDataOutdated")}>
      <Button
        onClick={onInstallData}
        loading={phase === "installing"}
        loadingLabel={installingLabel}
      >
        {phase === "installing" ? installingLabel : installLabel}
      </Button>
      {downloadSize}
    </Alert>
  );

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
            <Alert tone="danger">{errorMessage || t("writingRequestError")}</Alert>
          ) : !status?.installed ? (
            <EmptyState
              className="writing-data-state"
              title={stale ? t("writingDataOutdated") : t("writingDataMissing")}
              headingLevel={3}
              size="compact"
              actions={
                !installAllowed(capabilities?.writingDataInstall, status?.installable) ? (
                  <p className="writing-data-state__note">{t("writingInstalledByOperator")}</p>
                ) : status?.data?.available === false ? (
                  // No data release yet: an install button could only fail.
                  <p className="writing-data-state__note">{t("writingDataNotPublished")}</p>
                ) : (
                  <>
                    <Button
                      onClick={onInstallData}
                      loading={phase === "installing"}
                      loadingLabel={installingLabel}
                    >
                      {phase === "installing" ? installingLabel : installLabel}
                    </Button>
                    {downloadSize}
                  </>
                )
              }
            >
              {phase === "installing" && <ProgressBar label={t("writingDataInstalling")} />}
            </EmptyState>
          ) : phase === "loading" ? (
            <ProgressBar label={t("writingSearching")} />
          ) : results.length ? (
            <div className="writing-results">
              {staleNote}
              {coreOnly}
              <p className="writing-apply-hint" role="status">
                {replaceTarget ? t("valueReplacesSelection") : t("valueInsertsAtCursor")}
              </p>
              {results.map((result) => (
                <article key={`${result.source}-${result.lemma}-${result.values.join("|")}`}>
                  <header>
                    <strong>{result.lemma}</strong>
                    {result.partOfSpeech && (
                      <span className="writing-result__part-of-speech">
                        {partOfSpeechLabel(result.partOfSpeech, t)}
                      </span>
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
              {installedSources.length > 0 && (
                <footer className="writing-attribution">
                  <span>{t("writingAttribution")}</span>
                  <ul>
                    {installedSources.map((source) => (
                      <InstalledSourceItem key={source.name} source={source} />
                    ))}
                  </ul>
                  <p className="writing-attribution__edited">{t("writingEdited")}</p>
                </footer>
              )}
            </div>
          ) : writingQuery.trim() ? (
            <>
              <EmptyState title={t("writingNoResults")} headingLevel={3} size="compact" />
              {coreOnly}
            </>
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
