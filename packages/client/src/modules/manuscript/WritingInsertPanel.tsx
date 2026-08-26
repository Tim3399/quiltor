import { SlidersHorizontal } from "lucide-react";
import { Alert, Button, ChipAction, ChipList, Disclosure, EmptyState } from "../../design";
import { useI18n } from "../../i18n";
import type { FigureNode, FigureState } from "../story-world";
import type { Manuscript } from "./model";
import type { AmbiguousMention } from "./WritingAidInspector.types";

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

export interface WritingInsertPanelProps {
  manuscript: Manuscript;
  figures: FigureState;
  orphanedMentions: number;
  ambiguousMentions: AmbiguousMention[];
  symbolPicker: boolean;
  onSymbolPicker: (open: boolean) => void;
  onInsertEntity: (entity: FigureNode) => void;
  onResolveAmbiguous: (candidate: AmbiguousMention, entity: FigureNode) => void;
  onManageTerms: () => void;
  onInsert: (value: string) => void;
  onToggleSymbol: (symbol: string, active: boolean) => void;
}

export function WritingInsertPanel({
  manuscript,
  figures,
  orphanedMentions,
  ambiguousMentions,
  symbolPicker,
  onSymbolPicker,
  onInsertEntity,
  onResolveAmbiguous,
  onManageTerms,
  onInsert,
  onToggleSymbol,
}: WritingInsertPanelProps) {
  const { t } = useI18n();
  const projectDictionary = manuscript.words || [];

  return (
    <div className="writing-insert">
      <section>
        <h3>{t("figuresPlaces")}</h3>
        <ChipList className="chip-list" label={t("figuresPlaces")}>
          {figures.nodes.map((node) => (
            <ChipAction
              className="writing-insert-chip"
              key={node.id}
              onClick={() => onInsertEntity(node)}
            >
              {node.name}
            </ChipAction>
          ))}
        </ChipList>
      </section>
      {!!ambiguousMentions.length && (
        <section className="mention-review">
          <h3>{t("ambiguousMentions")}</h3>
          {ambiguousMentions.map((candidate) => (
            <div key={`${candidate.from}-${candidate.to}`}>
              <strong>{candidate.surface}</strong>
              <ChipList className="chip-list" label={candidate.surface}>
                {candidate.elementIds.map((id) => {
                  const node = figures.nodes.find((item) => item.id === id);
                  return node ? (
                    <ChipAction
                      className="writing-insert-chip"
                      key={id}
                      onClick={() => onResolveAmbiguous(candidate, node)}
                    >
                      {node.name} · {node.sub || node.label || t("worldObject")}
                    </ChipAction>
                  ) : null;
                })}
              </ChipList>
            </div>
          ))}
        </section>
      )}
      {orphanedMentions > 0 && (
        <Alert tone="warning" role="status">
          {t("orphanedMentionsRemoved").replace("{count}", String(orphanedMentions))}
        </Alert>
      )}
      <section>
        <div className="helper-section-heading">
          <h3>{t("ownTerms")}</h3>
          <Button
            appearance="ghost"
            size="compact"
            icon={<SlidersHorizontal />}
            onClick={onManageTerms}
          >
            {t("manageTerms")}
          </Button>
        </div>
        {projectDictionary.length ? (
          <ChipList className="chip-list" label={t("ownTerms")}>
            {projectDictionary.map((item) => {
              const word = typeof item === "string" ? item : item.w;
              return (
                <ChipAction
                  className="writing-insert-chip"
                  key={word}
                  onClick={() => onInsert(word)}
                >
                  {word}
                </ChipAction>
              );
            })}
          </ChipList>
        ) : (
          <EmptyState title={t("ownTermsEmpty")} headingLevel={3} size="compact" />
        )}
      </section>
      <section>
        <h3>{t("specialCharacters")}</h3>
        <ChipList className="chip-list symbols" label={t("specialCharacters")}>
          {(manuscript.zeichenAktiv || DEFAULT_SYMBOLS).map((symbol) => (
            <ChipAction
              className="writing-insert-chip writing-insert-symbol"
              key={symbol}
              onClick={() => onInsert(symbol)}
            >
              {symbol}
            </ChipAction>
          ))}
        </ChipList>
        <Disclosure
          className="symbol-picker"
          summary={t("chooseSymbols")}
          open={symbolPicker}
          onToggle={(event) => onSymbolPicker(event.currentTarget.open)}
        >
          <ChipList className="symbol-picker__chips" label={t("chooseSymbols")}>
            {AVAILABLE_SYMBOLS.map((symbol) => {
              const active = (manuscript.zeichenAktiv || []).includes(symbol);
              return (
                <ChipAction
                  className="symbol-picker__chip"
                  key={symbol}
                  selected={active}
                  onClick={() => onToggleSymbol(symbol, active)}
                >
                  {symbol}
                </ChipAction>
              );
            })}
          </ChipList>
        </Disclosure>
      </section>
    </div>
  );
}
