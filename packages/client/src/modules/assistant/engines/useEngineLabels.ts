import { useI18n } from "../../../i18n";
import { useInstanceCapabilities } from "../../../shared/capabilities";
import type { AssistantEngineKind } from "./types";

/**
 * The names of the engines, the same in the switch and in the drawer's header (T-275).
 *
 * Where the author installs the server's model herself (`instance.assistantInstall`), it runs
 * on her own computer and is named for that; elsewhere it is the operator's server AI.
 */
export function useEngineLabels(): Record<AssistantEngineKind, string> {
  const { t } = useI18n();
  const ownComputer = useInstanceCapabilities()?.assistantInstall === true;
  return {
    server: t(ownComputer ? "assistantEngineLocal" : "assistantEngineServer"),
    webllm: t("assistantEngineBrowser"),
    cloud: t("assistantEngineOwnKey"),
  };
}

/**
 * Whether the instance capabilities have arrived, and with them the name of the server engine.
 * Until then neither header nor switch names an engine: a computer of one's own would briefly
 * read "Server-KI", which it must never do (D-205, D-T-275-F3).
 */
export function useEngineLabelsKnown(): boolean {
  return useInstanceCapabilities() !== null;
}
