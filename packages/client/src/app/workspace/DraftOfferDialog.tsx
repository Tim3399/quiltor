import { useId } from "react";
import { Alert, Button, Dialog } from "../../design";
import { useI18n } from "../../i18n";

/** How many affected names the offer spells out before it says "and n more". */
const NAMED_ITEMS = 5;

/**
 * Offers a draft that was kept on this device because the session ended before it could be
 * saved (T-58 P7b). The author adopts it -- saved through the normal path, against the revision
 * it was written on -- or discards it. Closing decides nothing: it is offered again next time.
 */
export function DraftOfferDialog({
  familyLabel,
  savedAt,
  items,
  busy,
  error,
  onAdopt,
  onDiscard,
  onClose,
}: {
  familyLabel: string;
  savedAt: number;
  items: readonly string[];
  busy: boolean;
  error: string;
  onAdopt: () => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const descriptionId = useId();
  const named = items.slice(0, NAMED_ITEMS).join(", ") || familyLabel;
  const rest = items.length - NAMED_ITEMS;
  const affected = rest > 0 ? `${named} ${t("draftOfferMore", { n: rest })}` : named;
  const time = new Date(savedAt).toLocaleString(locale);
  return (
    <Dialog
      title={`${t("draftOfferTitle")}: ${familyLabel}`}
      closeLabel={t("closeDialog")}
      describedById={descriptionId}
      onClose={onClose}
      footer={
        <>
          <Button appearance="secondary" disabled={busy} onClick={onDiscard}>
            {t("draftOfferDiscard")}
          </Button>
          <Button appearance="primary" disabled={busy} onClick={onAdopt}>
            {t("draftOfferAdopt")}
          </Button>
        </>
      }
    >
      <p id={descriptionId}>{t("draftOfferBody", { time, items: affected })}</p>
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
    </Dialog>
  );
}
