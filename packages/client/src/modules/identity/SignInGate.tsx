import { PRODUCT_MARK } from "../../config/branding";
import { Alert, Button, PageState } from "../../design";
import type { MessageKey } from "../../i18n";
import { useI18n } from "../../i18n";

// Keys handle_auth_callback's four failure branches redirect here with
// (server.py, "?authError="); anything else -- including no code at all --
// falls back to the generic message.
const REASON_KEYS: Record<string, MessageKey> = {
  provider: "authErrorProvider",
  state: "authErrorState",
  expired: "authErrorExpired",
  exchange: "authErrorExchange",
};

export function SignInGate({ authError }: { authError: string | null }) {
  const { t } = useI18n();
  return (
    <PageState
      kind={authError ? "error" : "empty"}
      mark={PRODUCT_MARK}
      title={t("signInHeading")}
      actions={
        <Button
          appearance="primary"
          onClick={() => {
            location.href = "/login";
          }}
        >
          {t("signInButton")}
        </Button>
      }
    >
      <p>{t("signInIntro")}</p>
      {authError && <Alert tone="danger">{t(REASON_KEYS[authError] ?? "authErrorGeneric")}</Alert>}
    </PageState>
  );
}
