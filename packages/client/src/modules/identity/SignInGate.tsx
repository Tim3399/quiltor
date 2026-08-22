import { PRODUCT_MARK } from "../../config/branding";
import { useI18n } from "../../i18n";
import type { MessageKey } from "../../i18n";
import "./SignInGate.css";

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
    <main className="fatal-state">
      <div className="loading-mark">{PRODUCT_MARK}</div>
      <h1>{t("signInHeading")}</h1>
      <p>{t("signInIntro")}</p>
      {authError && (
        <div className="error-box" role="alert">
          {t(REASON_KEYS[authError] ?? "authErrorGeneric")}
        </div>
      )}
      <button
        className="sign-in-action"
        onClick={() => {
          location.href = "/login";
        }}
      >
        {t("signInButton")}
      </button>
    </main>
  );
}
