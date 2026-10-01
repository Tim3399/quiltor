import { BookOpen, FileInput, Search, Sparkles } from "lucide-react";
import { Button, Dialog } from "../../design";
import { useI18n } from "../../i18n";
import "./GettingStartedDialog.css";

export function GettingStartedDialog({
  onWrite,
  onImportText,
  onSearch,
  onAssistant,
  onClose,
}: {
  onWrite: () => void;
  onImportText: () => void;
  onSearch: () => void;
  onAssistant: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const action = (callback: () => void) => () => {
    onClose();
    callback();
  };
  return (
    <Dialog
      open
      title={t("gettingStartedTitle")}
      closeLabel={t("closeDialog")}
      onClose={onClose}
      size="wide"
    >
      <div className="getting-started-guide">
        <p>{t("gettingStartedIntro")}</p>
        <div className="getting-started-guide__tasks">
          <section>
            <BookOpen aria-hidden="true" />
            <div>
              <h3>{t("gettingStartedWrite")}</h3>
              <p>{t("gettingStartedWriteHelp")}</p>
            </div>
            <Button className="getting-started-guide__action" onClick={action(onWrite)}>
              {t("gettingStartedWriteAction")}
            </Button>
          </section>
          <section>
            <FileInput aria-hidden="true" />
            <div>
              <h3>{t("gettingStartedBringManuscript")}</h3>
              <p>{t("gettingStartedBringManuscriptHelp")}</p>
            </div>
            <Button className="getting-started-guide__action" onClick={action(onImportText)}>
              {t("gettingStartedBringManuscriptAction")}
            </Button>
          </section>
          <section>
            <Search aria-hidden="true" />
            <div>
              <h3>{t("gettingStartedFindFigure")}</h3>
              <p>{t("gettingStartedFindFigureHelp")}</p>
            </div>
            <Button className="getting-started-guide__action" onClick={action(onSearch)}>
              {t("gettingStartedFindFigureAction")}
            </Button>
          </section>
          <section>
            <Sparkles aria-hidden="true" />
            <div>
              <h3>{t("gettingStartedPrepareWorld")}</h3>
              <p>{t("gettingStartedPrepareWorldHelp")}</p>
            </div>
            <Button className="getting-started-guide__action" onClick={action(onAssistant)}>
              {t("gettingStartedPrepareWorldAction")}
            </Button>
          </section>
        </div>
      </div>
    </Dialog>
  );
}
