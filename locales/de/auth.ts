export const auth = {
  signInHeading: "Anmelden",
  signInIntro: "Diese Instanz verlangt eine Anmeldung über Keycloak, bevor sie deine Welten zeigt.",
  signInButton: "Mit Keycloak anmelden",
  authErrorProvider: "Die Anmeldung bei Keycloak wurde abgebrochen oder ist fehlgeschlagen.",
  authErrorState: "Die Anmeldung konnte nicht bestätigt werden — bitte erneut versuchen.",
  authErrorExpired:
    "Der Anmeldeversuch ist abgelaufen oder wurde schon verwendet. Bitte erneut versuchen.",
  authErrorExchange: "Anmeldung bei Keycloak fehlgeschlagen. Bitte erneut versuchen.",
  authErrorGeneric: "Die Anmeldung ist fehlgeschlagen. Bitte erneut versuchen.",
} as const;
