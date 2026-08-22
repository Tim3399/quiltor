import type { Translate } from "../../../i18n";
import { quiltorClient, saveTextFile } from "../../../platform";
import type { FigureState } from "../model";
import { PROFILE_FIELDS } from "./profileFields";

export function parseFigureState(text: string): FigureState {
  const value = JSON.parse(text) as FigureState;
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw new Error();
  return value;
}

export function serializeFigureState(state: FigureState): string {
  return JSON.stringify(state, null, 2);
}

export function serializeFigureProfiles(state: FigureState, t: Translate): string {
  return state.nodes
    .map((node) => {
      const profile = node.profile || {};
      const lines = [`# ${node.name}`, "", node.label ? `*${node.label}*` : "", node.sub || "", ""];
      PROFILE_FIELDS.forEach(([key, label]) => {
        const value = String(profile[key] || "").trim();
        if (value) lines.push(`## ${label}`, "", value, "");
      });
      (profile.extra || []).forEach((field) => {
        if (field.k || field.v) lines.push(`## ${field.k || t("untitled")}`, "", field.v || "", "");
      });
      return lines
        .filter((line, index) => line || lines[index - 1])
        .join("\n")
        .trim();
    })
    .join("\n\n---\n\n");
}

export function saveFigureState(state: FigureState, t: Translate): Promise<void> {
  return saveTextFile(
    quiltorClient.platform,
    `quiltor-figuren-${new Date().toISOString().slice(0, 10)}.json`,
    serializeFigureState(state),
    t("exportFailed"),
    "application/json",
  );
}

export function saveFigureProfiles(state: FigureState, t: Translate): Promise<void> {
  return saveTextFile(
    quiltorClient.platform,
    `Quiltor-Steckbriefe-${new Date().toISOString().slice(0, 10)}.md`,
    serializeFigureProfiles(state, t),
    t("exportFailed"),
  );
}
