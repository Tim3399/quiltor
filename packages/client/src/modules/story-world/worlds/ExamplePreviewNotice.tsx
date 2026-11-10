import { Alert, Button } from "../../../design";
import { useI18n } from "../../../i18n";

/**
 * The bar over an open preview of the example world (T-214-5b, D-127). It is a status, not a
 * question: nothing has to be done, and it goes once the first change is saved. When the
 * preview is gone -- left in another tab, or older than a day -- it says so and offers a
 * fresh one.
 */
export function ExamplePreviewNotice({
  expired = false,
  onOpenNew,
}: {
  expired?: boolean;
  onOpenNew?: () => void;
}) {
  const { t } = useI18n();
  return (
    <Alert
      className="example-preview-notice"
      tone={expired ? "warning" : "info"}
      role="status"
      action={
        expired && onOpenNew ? (
          <Button size="compact" onClick={onOpenNew}>
            {t("openExampleWorld")}
          </Button>
        ) : undefined
      }
    >
      {t(expired ? "examplePreviewExpired" : "examplePreviewBar")}
    </Alert>
  );
}
