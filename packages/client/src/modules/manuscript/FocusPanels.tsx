import { PanelLeft, PanelRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, ChipAction, ChipList, IconButton } from "../../design";
import { useI18n } from "../../i18n";
import type { FigureNode, FigureState } from "../story-world";
import { orderedChapters } from "./binder/manuscriptTree";
import type { Chapter, Manuscript } from "./model";
import { wordCount } from "./wordCount";
import "./FocusPanels.css";

interface FocusPanelsProps {
  focus: boolean;
  manuscript: Manuscript;
  figures: FigureState;
  current?: Chapter;
  onSelectChapter: (id: string) => void;
  onInsertEntity: (entity: FigureNode) => void;
  onInsert: (value: string) => void;
  onFocusEditor: () => void;
  onLeave: () => void;
}

export function FocusPanels({
  focus,
  manuscript,
  figures,
  current,
  onSelectChapter,
  onInsertEntity,
  onInsert,
  onFocusEditor,
  onLeave,
}: FocusPanelsProps) {
  const { t } = useI18n();
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [helpersOpen, setHelpersOpen] = useState(false);
  const chapters = orderedChapters(manuscript);

  useEffect(() => {
    if (!focus) setHelpersOpen(false);
  }, [focus]);

  if (!focus) return null;

  return (
    <>
      {chapters.length > 1 && (
        <aside
          className={`focus-chapters ${chaptersOpen ? "is-open" : ""}`}
          aria-label={t("focusChapterPickerLabel")}
        >
          <IconButton
            className="focus-side-toggle"
            aria-expanded={chaptersOpen}
            onClick={() => setChaptersOpen(!chaptersOpen)}
            title={t("selectChapters")}
            label={chaptersOpen ? t("closeChapterPicker") : t("openChapterPicker")}
            icon={chaptersOpen ? <X /> : <PanelLeft />}
          />
          {chaptersOpen && (
            <nav className="focus-chapter-list">
              {chapters.map((chapter, index) => (
                <Button
                  key={chapter.id}
                  className="focus-chapter-row"
                  title={chapter.title || t("untitled")}
                  appearance="ghost"
                  size="touch"
                  aria-current={chapter.id === current?.id ? "page" : undefined}
                  onClick={() => {
                    onSelectChapter(chapter.id);
                    requestAnimationFrame(onFocusEditor);
                  }}
                >
                  <span className="focus-chapter-row__content">
                    <span className="focus-chapter-row__number">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="focus-chapter-row__copy">
                      <strong>{chapter.title || t("untitled")}</strong>
                      <small>
                        {wordCount(chapter.body)} {t("words")}
                      </small>
                    </span>
                  </span>
                </Button>
              ))}
            </nav>
          )}
        </aside>
      )}
      <aside
        className={`focus-helper ${helpersOpen ? "is-open" : ""}`}
        aria-label={t("writingAidPanelLabel")}
      >
        <IconButton
          className="focus-helper-toggle"
          aria-expanded={helpersOpen}
          onClick={() => setHelpersOpen(!helpersOpen)}
          title={t("writingAid")}
          label={helpersOpen ? t("closeWritingAid") : t("openWritingAid")}
          icon={helpersOpen ? <X /> : <PanelRight />}
        />
        {helpersOpen && (
          <div className="focus-helper-panel">
            <section>
              <h3>{t("figuresPlaces")}</h3>
              <ChipList className="focus-helper-chips" label={t("figuresPlaces")}>
                {figures.nodes.map((node) => (
                  <ChipAction
                    className="focus-helper-chip"
                    key={node.id}
                    onClick={() => onInsertEntity(node)}
                  >
                    {node.name}
                  </ChipAction>
                ))}
              </ChipList>
            </section>
            {!!(manuscript.words || []).length && (
              <section>
                <h3>{t("ownTerms")}</h3>
                <ChipList className="focus-helper-chips" label={t("ownTerms")}>
                  {(manuscript.words || []).map((item) => {
                    const word = typeof item === "string" ? item : item.w;
                    return (
                      <ChipAction
                        className="focus-helper-chip"
                        key={word}
                        onClick={() => onInsert(word)}
                      >
                        {word}
                      </ChipAction>
                    );
                  })}
                </ChipList>
              </section>
            )}
            <section>
              <h3>{t("specialCharacters")}</h3>
              <ChipList
                className="focus-helper-chips focus-helper-symbols"
                label={t("specialCharacters")}
              >
                {(manuscript.zeichenAktiv || ["„", "“", "–", "—", "…"]).map((symbol) => (
                  <ChipAction
                    className="focus-helper-chip focus-helper-symbol"
                    key={symbol}
                    onClick={() => onInsert(symbol)}
                  >
                    {symbol}
                  </ChipAction>
                ))}
              </ChipList>
            </section>
          </div>
        )}
      </aside>
      <Button className="exit-focus" appearance="secondary" size="compact" onClick={onLeave}>
        {t("leaveFocus")} <kbd>Esc</kbd>
      </Button>
    </>
  );
}
