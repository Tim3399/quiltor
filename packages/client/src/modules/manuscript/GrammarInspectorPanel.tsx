import {
  Alert,
  Button,
  ChipAction,
  ChipList,
  EmptyState,
  ListboxSelect,
  ProgressBar,
  SelectableRow,
} from "../../design";
import { useI18n } from "../../i18n";
import type { WritingAssistanceStatus } from "../../platform";
import { installAllowed, useInstanceCapabilities } from "../../shared/capabilities";
import type { Chapter, Manuscript, WritingIssue } from "./model";
import type { GrammarPhase } from "./WritingAidInspector.types";

export interface GrammarInspectorPanelProps {
  current: Chapter;
  manuscript: Manuscript;
  status: WritingAssistanceStatus | null;
  issues: WritingIssue[];
  selectedIssue: WritingIssue | null;
  phase: GrammarPhase;
  /** Shown while `phase` is "error"; the generic sentence when empty. */
  errorMessage?: string;
  onCheck: () => void;
  onInstall: () => void;
  onSelectIssue: (issue: WritingIssue | null) => void;
  onApplyIssue: (issue: WritingIssue, replacement: string) => void;
  onGrammarMode: (mode: Manuscript["grammarMode"]) => void;
}

export function GrammarInspectorPanel({
  current,
  manuscript,
  status,
  issues,
  selectedIssue,
  phase,
  errorMessage,
  onCheck,
  onInstall,
  onSelectIssue,
  onApplyIssue,
  onGrammarMode,
}: GrammarInspectorPanelProps) {
  const { t } = useI18n();
  const grammar = status?.grammar;
  // A configured external server replaces the local LanguageTool, so neither
  // Java nor the download applies; without the opt-in it is simply not enabled.
  const external = !!grammar?.externalConfigured;
  const externalBlocked = external && !grammar?.externalEnabled;
  // Installing LanguageTool cannot succeed without Java, so the panel says what
  // is missing instead of offering a download that ends in an error.
  const javaMissing =
    !!grammar && (grammar.javaVersion === null || grammar.javaVersion < grammar.javaRequired);
  const mode = manuscript.grammarMode || "manual";
  // A hosted server's operator installs LanguageTool; the panel never offers it there.
  // Both flags count, as the two installable fields did before T-102.
  const capabilities = useInstanceCapabilities();
  const installable =
    installAllowed(capabilities?.grammarInstall, grammar?.installable) &&
    installAllowed(capabilities?.writingDataInstall, status?.installable);

  return (
    <div className="grammar-tool">
      <div className="grammar-heading">
        <Button
          appearance="primary"
          onClick={onCheck}
          loading={phase === "checking"}
          loadingLabel={t("grammarChecking")}
        >
          {phase === "checking" ? t("grammarChecking") : t("checkText")}
        </Button>
        {grammar?.available && phase !== "error" && (
          <span className="grammar-status muted" role="status">
            {phase === "checking"
              ? ""
              : issues.length
                ? t("grammarIssueCount").replace("{count}", String(issues.length))
                : t("grammarReady")}
          </span>
        )}
      </div>
      {phase === "checking" && <ProgressBar label={t("grammarChecking")} />}
      {!grammar?.available && (
        <EmptyState
          className="writing-data-state"
          title={
            externalBlocked
              ? t("grammarExternalOptInRequired")
              : javaMissing
                ? t("grammarJavaMissing").replace("{version}", String(grammar.javaRequired))
                : t("grammarUnavailable")
          }
          headingLevel={3}
          size="compact"
          actions={
            !installable ? (
              <p className="writing-data-state__note">{t("writingInstalledByOperator")}</p>
            ) : !external && !javaMissing && !grammar?.installed ? (
              <Button
                onClick={onInstall}
                loading={phase === "installing"}
                loadingLabel={t("grammarInstalling")}
              >
                {phase === "installing" ? t("grammarInstalling") : t("grammarInstall")}
              </Button>
            ) : undefined
          }
        >
          {t("grammarBrowserFallback")}
          {phase === "installing" && <ProgressBar label={t("grammarInstalling")} />}
        </EmptyState>
      )}
      {phase === "error" && <Alert tone="danger">{errorMessage || t("grammarCheckError")}</Alert>}
      {!!issues.length && (
        <ul className="grammar-issues">
          {issues.map((issue) => {
            const open = selectedIssue?.id === issue.id;
            const issueText = current.body.slice(issue.from, issue.to) || t("grammar");
            return (
              <li key={issue.id}>
                <SelectableRow
                  className="grammar-issue-row"
                  label={issueText}
                  title={issueText}
                  description={issue.category || t("grammar")}
                  selected={open}
                  aria-expanded={open}
                  onSelect={() => onSelectIssue(open ? null : issue)}
                />
                {open && (
                  <div className="grammar-issue-detail">
                    <p>{issue.message}</p>
                    {!!issue.replacements.length && (
                      <ChipList className="writing-values" label={t("grammar")}>
                        {issue.replacements.map((value) => (
                          <ChipAction
                            className="writing-value"
                            key={value}
                            onClick={() => onApplyIssue(issue, value)}
                          >
                            {value}
                          </ChipAction>
                        ))}
                      </ChipList>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ListboxSelect
        className="grammar-mode"
        label={t("grammarMode")}
        value={mode}
        options={[
          { value: "manual", label: t("grammarManual") },
          { value: "automatic", label: t("grammarAutomatic") },
        ]}
        onChange={onGrammarMode}
      />
      {(grammar?.installed || grammar?.externalEnabled) && (
        <footer className="writing-attribution">
          <span>{t("writingAttribution")}</span>
          <ul>
            <li>
              LanguageTool {grammar.version} · {grammar.download.license}
            </li>
          </ul>
        </footer>
      )}
    </div>
  );
}
