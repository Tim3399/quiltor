import { Plus } from "lucide-react";
import { useState } from "react";
import {
  Button,
  ChipList,
  EmptyState,
  IconButton,
  RemovableChip,
  Sheet,
  SheetBody,
  SheetHeader,
  TextField,
} from "../../design";
import { useI18n } from "../../i18n";
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
      <SheetHeader title={t("ownTerms")} closeLabel={t("close")} onClose={onClose} />
      <SheetBody className="terms-sheet">
        <p className="muted">{t("ownTermsIntro")}</p>
        <form
          className="add-term"
          onSubmit={(event) => {
            event.preventDefault();
            addWord();
          }}
        >
          <TextField
            data-autofocus
            fieldClassName="add-term__field"
            className="add-term__input"
            label={t("newTerm")}
            labelHidden
            value={newWord}
            onChange={(event) => setNewWord(event.target.value)}
            placeholder={t("addTerm")}
          />
          <IconButton
            type="submit"
            className="add-term__button"
            appearance="secondary"
            label={t("addTerm")}
            icon={<Plus />}
          />
        </form>
        {projectDictionary.length ? (
          <ChipList className="editable-chips" label={t("ownTerms")}>
            {projectDictionary.map((item, index) => {
              const word = typeof item === "string" ? item : item.w;
              return (
                <RemovableChip
                  key={word}
                  className="terms-sheet__chip"
                  removeLabel={t("removeTerm").replace("{word}", word)}
                  onRemove={() =>
                    onChange({
                      ...manuscript,
                      words: projectDictionary.filter((_, itemIndex) => itemIndex !== index),
                    })
                  }
                >
                  <Button
                    className="terms-sheet__term-action"
                    appearance="ghost"
                    size="compact"
                    onClick={() => onInsert(word)}
                  >
                    {word}
                  </Button>
                </RemovableChip>
              );
            })}
          </ChipList>
        ) : (
          <EmptyState title={t("ownTermsEmpty")} headingLevel={3} size="compact" />
        )}
      </SheetBody>
    </Sheet>
  );
}
