import { Copy, Search, SlidersHorizontal, X } from "lucide-react";
import { useI18n } from "../../i18n";
import {
  quiltorClient,
  type WritingAssistanceLookupResult,
  type WritingAssistanceStatus,
} from "../../platform";
import { SegmentedControl } from "../../shared/ui/SegmentedControl";
import type { FigureNode, FigureState } from "../story-world";
import type { Chapter, Manuscript, WritingIssue } from "./model";
import type { scanEntityMentions } from "./mentions";
import type { HelperMode, WritingTool } from "./workspaceTypes";
import "./WritingAidInspector.css";

type AmbiguousMention = ReturnType<typeof scanEntityMentions>["ambiguous"][number];
type WritingLocale = "de-DE" | "en-GB";
type AssistancePhase = "idle" | "loading" | "installing" | "error";
type GrammarPhase = "idle" | "checking" | "installing" | "unavailable" | "error";

interface WritingAidInspectorProps {
  current: Chapter;
  manuscript: Manuscript;
  figures: FigureState;
  orphanedMentions: number;
  helperModes: HelperMode[];
  activeMode: HelperMode;
  onMode: (mode: HelperMode) => void;
  selectionTool: WritingTool;
  writingLocale: WritingLocale;
  writingQuery: string;
  onWritingQuery: (value: string) => void;
  status: WritingAssistanceStatus | null;
  results: WritingAssistanceLookupResult[];
  assistancePhase: AssistancePhase;
  replaceTarget: boolean;
  lookupSources: string[];
  grammarIssues: WritingIssue[];
  selectedIssue: WritingIssue | null;
  grammarPhase: GrammarPhase;
  ambiguousMentions: AmbiguousMention[];
  symbolPicker: boolean;
  onSymbolPicker: (open: boolean) => void;
  onClose: () => void;
  onRunLookup: () => void;
  onChooseTool: (tool: WritingTool) => void;
  onLocale: (locale: WritingLocale) => void;
  onInstallData: () => void;
  onApplyValue: (value: string) => void;
  onCheckGrammar: () => void;
  onInstallGrammar: () => void;
  onSelectIssue: (issue: WritingIssue | null) => void;
  onApplyIssue: (issue: WritingIssue, replacement: string) => void;
  onGrammarMode: (mode: Manuscript["grammarMode"]) => void;
  onInsertEntity: (entity: FigureNode) => void;
  onResolveAmbiguous: (candidate: AmbiguousMention, entity: FigureNode) => void;
  onManageTerms: () => void;
  onInsert: (value: string) => void;
  onToggleSymbol: (symbol: string, active: boolean) => void;
}

const WRITING_TOOLS: WritingTool[] = ["lookup", "synonyms", "translate"];
const DEFAULT_SYMBOLS = ["„", "“", "–", "—", "…"];
const AVAILABLE_SYMBOLS = [
  "„",
  "“",
  "‚",
  "‘",
  "»",
  "«",
  "›",
  "‹",
  "–",
  "—",
  "…",
  "·",
  "§",
  "¶",
  "†",
  "°",
  "′",
  "″",
  "×",
  "±",
  "½",
  "¼",
];

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
  const projectDictionary = manuscript.words || [];
  const toolLabel = (tool: WritingTool) =>
    tool === "lookup" ? t("dictionary") : tool === "synonyms" ? t("synonyms") : t("translate");
  const modeLabel = (mode: HelperMode) =>
    mode === "lookup" ? t("helperLookup") : mode === "check" ? t("helperCheck") : t("helperInsert");
  const resultValues = (result: WritingAssistanceLookupResult) =>
    result.values.length ? result.values : [result.lemma];

  return (
    <>
      <div className="panel-heading panel-heading--inspector">
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label={t("closeWritingAid")}
          title={t("closeWritingAid")}
        >
          <X />
        </button>
        <span>{t("writingAid")}</span>
      </div>
      <div className="helper-panel">
        <div className="helper-modes" role="tablist" aria-label={t("writingAidSection")}>
          {helperModes.map((mode) => (
            <button
              key={mode}
              role="tab"
              aria-selected={activeMode === mode}
              onClick={() => onMode(mode)}
            >
              {modeLabel(mode)}
            </button>
          ))}
        </div>
        {activeMode === "lookup" ? (
          <div className="panel-body writing-lookup">
            <form
              className="writing-search"
              onSubmit={(event) => {
                event.preventDefault();
                onRunLookup();
              }}
            >
              <input
                aria-label={t("searchTerm")}
                value={writingQuery}
                onChange={(event) => onWritingQuery(event.target.value)}
                placeholder={t("writingSearchPlaceholder")}
              />
              <button
                className="icon-button"
                aria-label={t("lookup")}
                disabled={!writingQuery.trim() || assistancePhase === "loading"}
              >
                <Search />
              </button>
            </form>
            <div className="writing-tool-tabs" role="tablist" aria-label={t("lookupSources")}>
              {WRITING_TOOLS.map((tool) => (
                <button
                  key={tool}
                  role="tab"
                  aria-selected={selectionTool === tool}
                  onClick={() => onChooseTool(tool)}
                >
                  {toolLabel(tool)}
                </button>
              ))}
            </div>
            {selectionTool === "translate" && (
              <SegmentedControl
                label={t("translationDirection")}
                value={writingLocale}
                options={[
                  { value: "de-DE", label: t("germanToEnglish") },
                  { value: "en-GB", label: t("englishToGerman") },
                ]}
                onChange={onLocale}
              />
            )}
            {!status?.installed ? (
              <div className="writing-data-state">
                <p>{t("writingDataMissing")}</p>
                <button
                  className="ui-button"
                  onClick={onInstallData}
                  disabled={assistancePhase === "installing"}
                >
                  {assistancePhase === "installing"
                    ? t("writingDataInstalling")
                    : t("writingDataInstall")}
                </button>
              </div>
            ) : assistancePhase === "error" ? (
              <p className="error-box" role="alert">
                {t("writingRequestError")}
              </p>
            ) : assistancePhase === "loading" ? (
              <p className="muted" role="status">
                {t("writingSearching")}
              </p>
            ) : results.length ? (
              <div className="writing-results">
                <p className="writing-apply-hint" role="status">
                  {replaceTarget ? t("valueReplacesSelection") : t("valueInsertsAtCursor")}
                </p>
                {results.map((result, index) => (
                  <article key={`${result.source}-${result.lemma}-${index}`}>
                    <header>
                      <strong>{result.lemma}</strong>
                      {result.partOfSpeech && <span>{result.partOfSpeech}</span>}
                      <button
                        className="icon-button"
                        aria-label={t("writingCopy").replace("{word}", result.lemma)}
                        onClick={() =>
                          void quiltorClient.platform.clipboard.writeText(resultValues(result)[0])
                        }
                      >
                        <Copy />
                      </button>
                    </header>
                    {result.meaning && <p>{result.meaning}</p>}
                    <div className="writing-values">
                      {resultValues(result).map((value) => (
                        <button key={value} onClick={() => onApplyValue(value)}>
                          {value}
                        </button>
                      ))}
                    </div>
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
              <p className="muted">{t("writingNoResults")}</p>
            ) : (
              <div className="writing-empty">
                <p>{t("lookupEmptyHint")}</p>
                <p>{t("selectionMenuHint")}</p>
              </div>
            )}
          </div>
        ) : activeMode === "check" ? (
          <div className="panel-body grammar-tool">
            <div className="grammar-heading">
              <button
                className="ui-button primary"
                onClick={onCheckGrammar}
                disabled={grammarPhase === "checking"}
              >
                {grammarPhase === "checking" ? t("grammarChecking") : t("checkText")}
              </button>
              {status?.grammar?.available && grammarPhase !== "error" && (
                <span className="muted" role="status">
                  {grammarPhase === "checking"
                    ? ""
                    : grammarIssues.length
                      ? t("grammarIssueCount").replace("{count}", String(grammarIssues.length))
                      : t("grammarReady")}
                </span>
              )}
            </div>
            {!status?.grammar?.available && (
              <div className="writing-data-state">
                <p>
                  {status?.grammar?.installed
                    ? t("grammarJavaMissing").replace(
                        "{version}",
                        String(status.grammar.javaRequired),
                      )
                    : t("grammarUnavailable")}
                </p>
                {!status?.grammar?.installed && (
                  <button
                    className="ui-button"
                    onClick={onInstallGrammar}
                    disabled={grammarPhase === "installing"}
                  >
                    {grammarPhase === "installing" ? t("grammarInstalling") : t("grammarInstall")}
                  </button>
                )}
                <small>{t("grammarBrowserFallback")}</small>
              </div>
            )}
            {grammarPhase === "error" && (
              <p className="error-box" role="alert">
                {t("grammarCheckError")}
              </p>
            )}
            {!!grammarIssues.length && (
              <ul className="grammar-issues">
                {grammarIssues.map((issue) => {
                  const open = selectedIssue?.id === issue.id;
                  return (
                    <li key={issue.id}>
                      <button
                        className="grammar-issue-row"
                        aria-expanded={open}
                        onClick={() => onSelectIssue(open ? null : issue)}
                      >
                        <strong>{current.body.slice(issue.from, issue.to) || t("grammar")}</strong>
                        <span>{issue.category || t("grammar")}</span>
                      </button>
                      {open && (
                        <div className="grammar-issue-detail">
                          <p>{issue.message}</p>
                          {!!issue.replacements.length && (
                            <div className="writing-values">
                              {issue.replacements.map((value) => (
                                <button key={value} onClick={() => onApplyIssue(issue, value)}>
                                  {value}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <label className="field grammar-mode">
              <span>{t("grammarMode")}</span>
              <select
                value={manuscript.grammarMode || "manual"}
                onChange={(event) => onGrammarMode(event.target.value as Manuscript["grammarMode"])}
              >
                <option value="manual">{t("grammarManual")}</option>
                <option value="automatic">{t("grammarAutomatic")}</option>
              </select>
            </label>
            {status?.grammar?.installed && (
              <footer className="writing-attribution">
                <span>{t("writingAttribution")}</span>
                <ul>
                  <li>
                    LanguageTool {status.grammar.version} · {status.grammar.download.license}
                  </li>
                </ul>
              </footer>
            )}
          </div>
        ) : (
          <div className="panel-body writing-insert">
            <h3>{t("figuresPlaces")}</h3>
            <div className="chip-list">
              {figures.nodes.map((node) => (
                <button key={node.id} onClick={() => onInsertEntity(node)}>
                  {node.name}
                </button>
              ))}
            </div>
            {!!ambiguousMentions.length && (
              <section className="mention-review">
                <h3>{t("ambiguousMentions")}</h3>
                {ambiguousMentions.map((candidate) => (
                  <div key={`${candidate.from}-${candidate.to}`}>
                    <strong>{candidate.surface}</strong>
                    <div className="chip-list">
                      {candidate.elementIds.map((id) => {
                        const node = figures.nodes.find((item) => item.id === id);
                        return (
                          node && (
                            <button key={id} onClick={() => onResolveAmbiguous(candidate, node)}>
                              {node.name} · {node.sub || node.label || t("worldObject")}
                            </button>
                          )
                        );
                      })}
                    </div>
                  </div>
                ))}
              </section>
            )}
            {orphanedMentions > 0 && (
              <p className="muted" role="status">
                {t("orphanedMentionsRemoved").replace("{count}", String(orphanedMentions))}
              </p>
            )}
            <div className="helper-section-heading">
              <h3>{t("ownTerms")}</h3>
              <button className="text-action" onClick={onManageTerms}>
                <SlidersHorizontal />
                {t("manageTerms")}
              </button>
            </div>
            {projectDictionary.length ? (
              <div className="chip-list">
                {projectDictionary.map((item, index) => {
                  const word = typeof item === "string" ? item : item.w;
                  return (
                    <button key={`${word}-${index}`} onClick={() => onInsert(word)}>
                      {word}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="muted">{t("ownTermsEmpty")}</p>
            )}
            <h3>{t("specialCharacters")}</h3>
            <div className="chip-list symbols">
              {(manuscript.zeichenAktiv || DEFAULT_SYMBOLS).map((symbol) => (
                <button key={symbol} onClick={() => onInsert(symbol)}>
                  {symbol}
                </button>
              ))}
              <button
                aria-expanded={symbolPicker}
                aria-label={t("chooseSymbols")}
                onClick={() => onSymbolPicker(!symbolPicker)}
              >
                ±
              </button>
            </div>
            {symbolPicker && (
              <div className="symbol-picker">
                {AVAILABLE_SYMBOLS.map((symbol) => {
                  const active = (manuscript.zeichenAktiv || []).includes(symbol);
                  return (
                    <button
                      key={symbol}
                      aria-pressed={active}
                      onClick={() => onToggleSymbol(symbol, active)}
                    >
                      {symbol}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
