import { useEffect, useState } from "react";
import { PanelLeft, PanelRight, X } from "lucide-react";
import { useI18n } from "../../i18n";
import type { FigureNode, FigureState } from "../story-world";
import type { Chapter, Manuscript } from "./model";
import { orderedChapters } from "./binder/manuscriptTree";
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
          <button
            className="focus-side-toggle"
            aria-expanded={chaptersOpen}
            onClick={() => setChaptersOpen(!chaptersOpen)}
            title={t("selectChapters")}
          >
            {chaptersOpen ? <X /> : <PanelLeft />}
            <span className="sr-only">
              {chaptersOpen ? t("closeChapterPicker") : t("openChapterPicker")}
            </span>
          </button>
          {chaptersOpen && (
            <nav className="focus-chapter-list">
              {chapters.map((chapter, index) => (
                <button
                  key={chapter.id}
                  className={chapter.id === current?.id ? "active" : ""}
                  aria-current={chapter.id === current?.id ? "page" : undefined}
                  onClick={() => {
                    onSelectChapter(chapter.id);
                    requestAnimationFrame(onFocusEditor);
                  }}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{chapter.title || t("untitled")}</strong>
                  <small>
                    {wordCount(chapter.body)} {t("words")}
                  </small>
                </button>
              ))}
            </nav>
          )}
        </aside>
      )}
      <aside
        className={`focus-helper ${helpersOpen ? "is-open" : ""}`}
        aria-label={t("writingAidPanelLabel")}
      >
        <button
          className="focus-helper-toggle"
          aria-expanded={helpersOpen}
          onClick={() => setHelpersOpen(!helpersOpen)}
          title={t("writingAid")}
        >
          {helpersOpen ? <X /> : <PanelRight />}
          <span className="sr-only">
            {helpersOpen ? t("closeWritingAid") : t("openWritingAid")}
          </span>
        </button>
        {helpersOpen && (
          <div className="focus-helper-panel">
            <section>
              <h3>{t("figuresPlaces")}</h3>
              <div className="focus-helper-chips">
                {figures.nodes.map((node) => (
                  <button key={node.id} onClick={() => onInsertEntity(node)}>
                    {node.name}
                  </button>
                ))}
              </div>
            </section>
            {!!(manuscript.words || []).length && (
              <section>
                <h3>{t("ownTerms")}</h3>
                <div className="focus-helper-chips">
                  {(manuscript.words || []).map((item, index) => {
                    const word = typeof item === "string" ? item : item.w;
                    return (
                      <button key={`${word}-${index}`} onClick={() => onInsert(word)}>
                        {word}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
            <section>
              <h3>{t("specialCharacters")}</h3>
              <div className="focus-helper-chips focus-helper-symbols">
                {(manuscript.zeichenAktiv || ["„", "“", "–", "—", "…"]).map((symbol) => (
                  <button key={symbol} onClick={() => onInsert(symbol)}>
                    {symbol}
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}
      </aside>
      <button className="exit-focus" onClick={onLeave}>
        {t("leaveFocus")} <kbd>Esc</kbd>
      </button>
    </>
  );
}
