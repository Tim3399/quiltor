import type { Translate } from "../../../i18n";
import { quiltorClient, saveTextFile, validateNoteMarks } from "../../../platform";
import { noteMarkdown } from "../../notes";
import type { FigureState } from "../model";
import { normalizeProfile, normalizeProfileFields } from "../profile";
import { PROFILE_FIELD_TEMPLATES } from "./profileFields";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalizeImportedNoteMarks(
  owner: Record<string, unknown>,
  textKey: "notizen" | "note",
  path: string,
) {
  if (!("noteMarks" in owner)) return;
  try {
    owner.noteMarks = validateNoteMarks(
      owner.noteMarks,
      typeof owner[textKey] === "string" ? owner[textKey] : "",
      `${path}.noteMarks`,
    );
  } catch {
    throw new Error("Invalid figure note formatting");
  }
}

function assertImportProfile(
  profile: unknown,
): asserts profile is FigureState["nodes"][number]["profile"] {
  if (!isRecord(profile)) throw new Error("Invalid figure profile");
  canonicalizeImportedNoteMarks(profile, "notizen", "profile");
  if (
    "extra" in profile &&
    (!Array.isArray(profile.extra) ||
      profile.extra.some(
        (field) => !isRecord(field) || typeof field.k !== "string" || typeof field.v !== "string",
      ))
  )
    throw new Error("Invalid legacy figure profile fields");
  if ("fields" in profile) {
    if (!Array.isArray(profile.fields)) throw new Error("Invalid figure profile fields");
    const seen = new Set<string>();
    for (const field of profile.fields) {
      if (
        !isRecord(field) ||
        typeof field.id !== "string" ||
        !field.id ||
        typeof field.key !== "string" ||
        typeof field.value !== "string" ||
        seen.has(field.id)
      )
        throw new Error("Invalid figure profile field");
      seen.add(field.id);
    }
  } else {
    for (const key of ["alter", "rolle", "aussehen", "herkunft", "stimme"] as const) {
      if (key in profile && typeof profile[key] !== "string")
        throw new Error("Invalid legacy figure profile field");
    }
  }
}

export function parseFigureState(text: string): FigureState {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) throw new Error("Invalid figure diagram");
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw new Error();
  for (const node of value.nodes) {
    if (!isRecord(node) || typeof node.id !== "string") throw new Error("Invalid figure node");
    if ("profile" in node && node.profile !== undefined) assertImportProfile(node.profile);
  }
  if ("timeline" in value) {
    if (!Array.isArray(value.timeline)) throw new Error("Invalid figure timeline");
    value.timeline.forEach((moment, index) => {
      if (!isRecord(moment)) throw new Error("Invalid figure timeline moment");
      canonicalizeImportedNoteMarks(moment, "note", `timeline[${index}]`);
    });
  }
  const state = value as unknown as FigureState;
  return {
    ...state,
    nodes: state.nodes.map((node) => ({
      ...node,
      ...(node.profile ? { profile: normalizeProfile(node.profile, node.id) } : {}),
    })),
  };
}

export function serializeFigureState(state: FigureState): string {
  return JSON.stringify(
    {
      ...state,
      nodes: state.nodes.map((node) => ({
        ...node,
        ...(node.profile ? { profile: normalizeProfile(node.profile, node.id) } : {}),
      })),
    },
    null,
    2,
  );
}

export function serializeFigureProfiles(state: FigureState, t: Translate): string {
  return state.nodes
    .map((node) => {
      const profile = node.profile || {};
      const lines = [`# ${node.name}`, "", node.label ? `*${node.label}*` : "", node.sub || "", ""];
      const notes = noteMarkdown(String(profile.notizen || ""), profile.noteMarks, 2).trim();
      if (notes) lines.push(`## ${t("profileNotes")}`, "", notes, "");
      const fields = normalizeProfileFields(profile, node.id, (legacyKey) => {
        const template = PROFILE_FIELD_TEMPLATES.find((item) => item.legacyKey === legacyKey);
        return template ? t(template.label) : legacyKey;
      });
      fields.forEach((field) => {
        if (field.key || field.value)
          lines.push(`## ${field.key || t("untitled")}`, "", field.value || "", "");
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
