import { useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "../../i18n";
import { Sheet } from "../../shared/ui/Sheet";
import type { Manuscript } from "./model";
import "./TermsSheet.css";

interface TermsSheetProps {
  open: boolean;
  manuscript: Manuscript;
  onChange: (manuscript: Manuscript) => void;
  onInsert: (value: string) => void;
  onClose: () => void;
}

export function TermsSheet({ open, manuscript, onChange, onInsert, onClose }: TermsSheetProps) {
  const { t } = useI18n();
  const [newWord, setNewWord] = useState("");
  const projectDictionary = manuscript.words || [];
  const addWord = () => {
    const value = newWord.trim();
    if (!value) return;
    if (
      !projectDictionary.some(
        (item) =>
          (typeof item === "string" ? item : item.w).toLocaleLowerCase("de-DE") ===
          value.toLocaleLowerCase("de-DE"),
      )
    )
      onChange({ ...manuscript, words: [...projectDictionary, { w: value, d: "" }] });
    setNewWord("");
  };

  return (
    <Sheet open={open} label={t("ownTerms")} onClose={onClose}>
      <div className="terms-sheet">
        <header>
          <h2>{t("ownTerms")}</h2>
          <button className="icon-button" onClick={onClose} aria-label={t("close")}>
            <X />
          </button>
        </header>
        <p className="muted">{t("ownTermsIntro")}</p>
        <div className="add-term">
          <input
            data-autofocus
            aria-label={t("newTerm")}
            value={newWord}
            onChange={(event) => setNewWord(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addWord();
            }}
            placeholder={t("addTerm")}
          />
          <button onClick={addWord} aria-label={t("addTerm")}>
            +
          </button>
        </div>
        {projectDictionary.length ? (
          <div className="chip-list editable-chips">
            {projectDictionary.map((item, index) => {
              const word = typeof item === "string" ? item : item.w;
              return (
                <span key={`${word}-${index}`}>
                  <button onClick={() => onInsert(word)}>{word}</button>
                  <button
                    aria-label={t("removeTerm").replace("{word}", word)}
                    onClick={() =>
                      onChange({
                        ...manuscript,
                        words: projectDictionary.filter((_, itemIndex) => itemIndex !== index),
                      })
                    }
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        ) : (
          <p className="muted">{t("ownTermsEmpty")}</p>
        )}
      </div>
    </Sheet>
  );
}
