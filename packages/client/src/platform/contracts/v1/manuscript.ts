import type { Manuscript } from "../../../modules/manuscript";
import {
  type DecodedDocumentV1,
  type DocumentEnvelopeWireV1,
  decodeDocumentEnvelopeV1,
  encodeDocumentEnvelopeV1,
} from "./documentEnvelope";
import {
  cloneNoteReferences,
  type NoteReferenceWireV1,
  validateNoteReferences,
} from "./noteReference";
import {
  optional,
  WireContractError,
  wireArray,
  wireEnum,
  wireInteger,
  wireNumber,
  wireRecord,
  wireString,
} from "./validation";

export interface EntityMentionWireV1 {
  id: string;
  elementId: string;
  from: number;
  to: number;
  surface: string;
  source: "completion" | "helper" | "deterministic" | "llm-assisted";
  confidence: number;
  [key: string]: unknown;
}

export interface TextMarkWireV1 {
  from: number;
  to: number;
  kind: "bold" | "italic";
  [key: string]: unknown;
}

export interface ChapterStoryTimeWireV1 {
  startMomentId: string;
  endMomentId?: string;
  [key: string]: unknown;
}

export interface ChapterWireV1 {
  id: string;
  title?: string;
  body?: string;
  note?: string;
  noteReferences?: NoteReferenceWireV1[];
  storyTime?: ChapterStoryTimeWireV1;
  mentions?: EntityMentionWireV1[];
  marks?: TextMarkWireV1[];
  [key: string]: unknown;
}

export interface ChapterFolderWireV1 {
  id: string;
  title: string;
  [key: string]: unknown;
}

export interface ManuscriptTreeItemWireV1 {
  id: string;
  kind: "chapter" | "folder";
  chapterId?: string;
  folderId?: string;
  parentFolderId?: string;
  position: number;
  [key: string]: unknown;
}

export interface ManuscriptStructureWireV1 {
  folders: ChapterFolderWireV1[];
  items: ManuscriptTreeItemWireV1[];
  [key: string]: unknown;
}

export interface ManuscriptPayloadWireV1 {
  chapters: ChapterWireV1[];
  structure?: ManuscriptStructureWireV1;
  language?: "de-DE";
  grammarMode?: "manual" | "automatic";
  words?: Array<string | { w: string; d?: string; [key: string]: unknown }>;
  zeichenAktiv?: string[];
  [key: string]: unknown;
}

export type ManuscriptWireV1 = DocumentEnvelopeWireV1<ManuscriptPayloadWireV1>;

/** V1 editor offsets are UTF-16 code units and may not split a surrogate pair. */
function isUtf16Boundary(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return true;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}

function manuscriptPayload(value: unknown, path: string): ManuscriptPayloadWireV1 {
  const payload = wireRecord(value, path);
  const chapters = wireArray(payload.chapters, `${path}.chapters`);
  const chapterIds = new Set<string>();
  for (const [index, chapterValue] of chapters.entries()) {
    const chapterPath = `${path}.chapters[${index}]`;
    const chapter = wireRecord(chapterValue, chapterPath);
    const id = wireString(chapter.id, `${chapterPath}.id`, { min: 1, max: 200 });
    if (chapterIds.has(id)) throw new WireContractError(`${chapterPath}.id`);
    chapterIds.add(id);
    optional(
      chapter,
      "title",
      (item, itemPath) => wireString(item, itemPath, { max: 1000 }),
      chapterPath,
    );
    optional(
      chapter,
      "body",
      (item, itemPath) => wireString(item, itemPath, { max: 10_000_000 }),
      chapterPath,
    );
    optional(
      chapter,
      "note",
      (item, itemPath) => wireString(item, itemPath, { max: 100_000 }),
      chapterPath,
    );
    const note = typeof chapter.note === "string" ? chapter.note : "";
    if (chapter.noteReferences !== undefined) {
      validateNoteReferences(chapter.noteReferences, note, `${chapterPath}.noteReferences`);
    }
    optional(
      chapter,
      "storyTime",
      (item, itemPath) => {
        const storyTime = wireRecord(item, itemPath);
        const momentId = (value: unknown, path: string) => {
          const id = wireString(value, path, { min: 1, max: 200 });
          if (id.trim() !== id) throw new WireContractError(path);
          return id;
        };
        const startMomentId = momentId(storyTime.startMomentId, `${itemPath}.startMomentId`);
        optional(storyTime, "endMomentId", momentId, itemPath);
        if (storyTime.endMomentId === startMomentId) {
          throw new WireContractError(`${itemPath}.endMomentId`);
        }
      },
      chapterPath,
    );
    const body = typeof chapter.body === "string" ? chapter.body : "";

    if (chapter.mentions !== undefined) {
      const mentions = wireArray(chapter.mentions, `${chapterPath}.mentions`);
      if (mentions.length > 10_000) throw new WireContractError(`${chapterPath}.mentions`);
      const mentionIds = new Set<string>();
      const mentionRanges: Array<{ from: number; to: number }> = [];
      for (const [mentionIndex, mentionValue] of mentions.entries()) {
        const mentionPath = `${chapterPath}.mentions[${mentionIndex}]`;
        const mention = wireRecord(mentionValue, mentionPath);
        const mentionId = wireString(mention.id, `${mentionPath}.id`, {
          min: 1,
          max: 500,
        });
        if (mentionIds.has(mentionId)) throw new WireContractError(`${mentionPath}.id`);
        mentionIds.add(mentionId);
        wireString(mention.elementId, `${mentionPath}.elementId`, { min: 1, max: 500 });
        const from = wireInteger(mention.from, `${mentionPath}.from`, { min: 0 });
        const to = wireInteger(mention.to, `${mentionPath}.to`, { min: 1 });
        const surface = wireString(mention.surface, `${mentionPath}.surface`, {
          min: 1,
          max: 500,
        });
        wireEnum(
          mention.source,
          ["completion", "helper", "deterministic", "llm-assisted"] as const,
          `${mentionPath}.source`,
        );
        wireNumber(mention.confidence, `${mentionPath}.confidence`, { min: 0, max: 1 });
        if (
          to <= from ||
          to > body.length ||
          !isUtf16Boundary(body, from) ||
          !isUtf16Boundary(body, to) ||
          body.slice(from, to) !== surface
        ) {
          throw new WireContractError(mentionPath);
        }
        mentionRanges.push({ from, to });
      }
      let previousMentionEnd = -1;
      for (const range of mentionRanges.sort((left, right) => left.from - right.from)) {
        if (range.from < previousMentionEnd) {
          throw new WireContractError(`${chapterPath}.mentions`);
        }
        previousMentionEnd = range.to;
      }
    }

    if (chapter.marks !== undefined) {
      const previousMarkEnd = new Map<string, number>();
      for (const { index: markIndex, mark: markValue } of wireArray(
        chapter.marks,
        `${chapterPath}.marks`,
      )
        .map((mark, index) => ({ mark, index }))
        .sort((left, right) => {
          const leftRecord = wireRecord(left.mark, `${chapterPath}.marks[${left.index}]`);
          const rightRecord = wireRecord(right.mark, `${chapterPath}.marks[${right.index}]`);
          return Number(leftRecord.from) - Number(rightRecord.from);
        })) {
        const markPath = `${chapterPath}.marks[${markIndex}]`;
        const mark = wireRecord(markValue, markPath);
        const from = wireInteger(mark.from, `${markPath}.from`, { min: 0 });
        const to = wireInteger(mark.to, `${markPath}.to`, { min: 1 });
        const kind = wireEnum(mark.kind, ["bold", "italic"] as const, `${markPath}.kind`);
        if (
          to <= from ||
          to > body.length ||
          !isUtf16Boundary(body, from) ||
          !isUtf16Boundary(body, to) ||
          from < (previousMarkEnd.get(kind) ?? -1)
        ) {
          throw new WireContractError(markPath);
        }
        previousMarkEnd.set(kind, to);
      }
    }
  }

  if (payload.structure !== undefined) {
    const structurePath = `${path}.structure`;
    const structure = wireRecord(payload.structure, structurePath);
    const folders = wireArray(structure.folders, `${structurePath}.folders`);
    const folderIds = new Set<string>();
    for (const [index, folderValue] of folders.entries()) {
      const folderPath = `${structurePath}.folders[${index}]`;
      const folder = wireRecord(folderValue, folderPath);
      const id = wireString(folder.id, `${folderPath}.id`, { min: 1, max: 200 });
      wireString(folder.title, `${folderPath}.title`, { max: 1000 });
      if (folderIds.has(id)) throw new WireContractError(`${folderPath}.id`);
      folderIds.add(id);
    }
    const items = wireArray(structure.items, `${structurePath}.items`);
    const itemIds = new Set<string>();
    const ownedChapters = new Set<string>();
    const ownedFolders = new Set<string>();
    const folderParents = new Map<string, string | undefined>();
    const siblingPositions = new Map<string, Set<number>>();
    for (const [index, itemValue] of items.entries()) {
      const itemPath = `${structurePath}.items[${index}]`;
      const item = wireRecord(itemValue, itemPath);
      const id = wireString(item.id, `${itemPath}.id`, { min: 1, max: 500 });
      if (itemIds.has(id)) throw new WireContractError(`${itemPath}.id`);
      itemIds.add(id);
      const kind = wireEnum(item.kind, ["chapter", "folder"] as const, `${itemPath}.kind`);
      const position = wireInteger(item.position, `${itemPath}.position`, { min: 0 });
      const parent =
        item.parentFolderId === undefined
          ? undefined
          : wireString(item.parentFolderId, `${itemPath}.parentFolderId`, {
              min: 1,
              max: 200,
            });
      if (parent !== undefined && !folderIds.has(parent)) {
        throw new WireContractError(`${itemPath}.parentFolderId`);
      }
      const positions = siblingPositions.get(parent ?? "") ?? new Set<number>();
      if (positions.has(position)) throw new WireContractError(`${itemPath}.position`);
      positions.add(position);
      siblingPositions.set(parent ?? "", positions);
      if (kind === "chapter") {
        const chapterId = wireString(item.chapterId, `${itemPath}.chapterId`, {
          min: 1,
          max: 200,
        });
        if (
          item.folderId !== undefined ||
          !chapterIds.has(chapterId) ||
          ownedChapters.has(chapterId)
        ) {
          throw new WireContractError(itemPath);
        }
        ownedChapters.add(chapterId);
      } else {
        const folderId = wireString(item.folderId, `${itemPath}.folderId`, { min: 1, max: 200 });
        if (
          item.chapterId !== undefined ||
          !folderIds.has(folderId) ||
          ownedFolders.has(folderId) ||
          parent === folderId
        ) {
          throw new WireContractError(itemPath);
        }
        ownedFolders.add(folderId);
        folderParents.set(folderId, parent);
      }
    }
    if (
      ownedChapters.size !== chapterIds.size ||
      ownedFolders.size !== folderIds.size ||
      [...chapterIds].some((id) => !ownedChapters.has(id)) ||
      [...folderIds].some((id) => !ownedFolders.has(id))
    ) {
      throw new WireContractError(structurePath);
    }
    for (const positions of siblingPositions.values()) {
      if ([...positions].some((position) => position >= positions.size)) {
        throw new WireContractError(`${structurePath}.items`);
      }
    }
    for (const folderId of folderIds) {
      const seen = new Set([folderId]);
      let parent = folderParents.get(folderId);
      while (parent) {
        if (seen.has(parent)) throw new WireContractError(`${structurePath}.items`);
        seen.add(parent);
        parent = folderParents.get(parent);
      }
    }
  }

  optional(
    payload,
    "language",
    (item, itemPath) => wireEnum(item, ["de-DE"] as const, itemPath),
    path,
  );
  optional(
    payload,
    "grammarMode",
    (item, itemPath) => wireEnum(item, ["manual", "automatic"] as const, itemPath),
    path,
  );
  if (payload.words !== undefined) {
    for (const [index, word] of wireArray(payload.words, `${path}.words`).entries()) {
      if (typeof word === "string") continue;
      const itemPath = `${path}.words[${index}]`;
      const item = wireRecord(word, itemPath);
      wireString(item.w, `${itemPath}.w`);
      optional(item, "d", wireString, itemPath);
    }
  }
  if (payload.zeichenAktiv !== undefined) {
    for (const [index, character] of wireArray(
      payload.zeichenAktiv,
      `${path}.zeichenAktiv`,
    ).entries()) {
      wireString(character, `${path}.zeichenAktiv[${index}]`);
    }
  }
  return payload as unknown as ManuscriptPayloadWireV1;
}

function cloneChapter(wire: ChapterWireV1): ChapterWireV1 {
  const chapter = { ...wire };
  chapter.noteReferences = cloneNoteReferences(wire.noteReferences);
  if (wire.storyTime !== undefined) chapter.storyTime = { ...wire.storyTime };
  if (wire.mentions !== undefined) {
    chapter.mentions = wire.mentions.map((mention) => ({ ...mention }));
  }
  if (wire.marks !== undefined) chapter.marks = wire.marks.map((mark) => ({ ...mark }));
  return chapter;
}

function encodeChapter(chapter: Manuscript["chapters"][number]): ChapterWireV1 {
  return {
    ...chapter,
    noteReferences: cloneNoteReferences(chapter.noteReferences),
    storyTime: chapter.storyTime ? { ...chapter.storyTime } : undefined,
    mentions: chapter.mentions?.map((mention) => ({ ...mention })),
    marks: chapter.marks?.map((mark) => ({ ...mark })),
  };
}

export function decodeManuscriptV1(value: unknown): DecodedDocumentV1<Manuscript> {
  const wire = decodeDocumentEnvelopeV1(value, "quiltor.manuscript", manuscriptPayload);
  const structure = wire.payload.structure ?? {
    folders: [],
    items: wire.payload.chapters.map((chapter, position) => ({
      id: `chapter:${chapter.id}`,
      kind: "chapter" as const,
      chapterId: chapter.id,
      position,
    })),
  };
  return {
    document: {
      ...wire.payload,
      structure: {
        ...structure,
        folders: structure.folders.map((folder) => ({ ...folder })),
        items: structure.items.map((item) =>
          item.kind === "chapter"
            ? { ...item, kind: "chapter" as const, chapterId: item.chapterId as string }
            : { ...item, kind: "folder" as const, folderId: item.folderId as string },
        ),
      },
      chapters: wire.payload.chapters.map((chapter) => ({
        ...cloneChapter(chapter),
        title: chapter.title ?? "",
        body: chapter.body ?? "",
        note: chapter.note ?? "",
      })),
    },
    revision: wire.revision,
  };
}

export function encodeManuscriptV1(model: Manuscript, revision?: number): ManuscriptWireV1 {
  const payload = {
    ...model,
    chapters: model.chapters.map(encodeChapter),
  } as ManuscriptPayloadWireV1;
  return encodeDocumentEnvelopeV1("quiltor.manuscript", payload, revision, manuscriptPayload);
}
