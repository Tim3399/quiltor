import type { Manuscript } from "../../../modules/manuscript";
import { type BookLayoutWireV1, cloneBookLayoutV1, validateBookLayoutV1 } from "./bookLayout";
import {
  type DecodedDocumentV1,
  type DocumentEnvelopeWireV1,
  decodeDocumentEnvelopeV1,
  encodeDocumentEnvelopeV1,
} from "./documentEnvelope";
import { cloneNoteMarks, type NoteMarkWireV1, validateNoteMarks } from "./noteMark";
import {
  cloneNoteReferences,
  type NoteReferenceWireV1,
  validateNoteReferences,
} from "./noteReference";
import {
  optional,
  WireContractError,
  wireArray,
  wireBoolean,
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
  noteMarks?: NoteMarkWireV1[];
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

export interface ChapterTrashEntryWireV1 {
  chapter: ChapterWireV1;
  deletedAt: string;
  originalFolderPath: ChapterFolderWireV1[];
  treeItem: ManuscriptTreeItemWireV1 & { kind: "chapter"; chapterId: string };
  [key: string]: unknown;
}

interface ManuscriptImportSourceWireBaseV1 {
  fileName: string;
  sourceSha256: string;
  importedAt: string;
  counts: {
    sourceWords: number;
    sourceParagraphs: number;
    importedWords: number;
    importedParagraphs: number;
    [key: string]: unknown;
  };
  warnings: Array<{
    code:
      | "images"
      | "hyperlinks"
      | "headers_footers"
      | "footnotes_endnotes"
      | "comments"
      | "numbering"
      | "fields"
      | "formatting";
    count: number;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export type ManuscriptImportSourceWireV1 = ManuscriptImportSourceWireBaseV1 &
  ({ version: 1; format: "docx" } | { version: 2; format: "docx" | "markdown" | "txt" });

export interface ManuscriptPayloadWireV1 {
  chapters: ChapterWireV1[];
  importSource?: ManuscriptImportSourceWireV1;
  trash?: ChapterTrashEntryWireV1[];
  bookLayout?: BookLayoutWireV1;
  structure?: ManuscriptStructureWireV1;
  language?: "de-DE";
  grammarMode?: "manual" | "automatic";
  words?: Array<string | { w: string; d?: string; [key: string]: unknown }>;
  /** Special characters the writer keeps in the insert panel. */
  activeSymbols?: string[];
  /**
   * World elements the insert panel does not offer.
   *
   * What is stored is the hidden set, not the visible one: a figure created after this
   * setting was made should show up, not have to be unlocked first.
   */
  hiddenElements?: string[];
  [key: string]: unknown;
}

export type ManuscriptWireV1 = DocumentEnvelopeWireV1<ManuscriptPayloadWireV1>;

const importWarningCodes = [
  "images",
  "hyperlinks",
  "headers_footers",
  "footnotes_endnotes",
  "comments",
  "numbering",
  "fields",
  "formatting",
] as const;

function isValidUtcTimestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?Z$/.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map((part) => Number(part));
  if (year < 1) return false;
  const instant = new Date(0);
  instant.setUTCFullYear(year, month - 1, day);
  instant.setUTCHours(hour, minute, second, 0);
  return (
    instant.getUTCFullYear() === year &&
    instant.getUTCMonth() === month - 1 &&
    instant.getUTCDate() === day &&
    instant.getUTCHours() === hour &&
    instant.getUTCMinutes() === minute &&
    instant.getUTCSeconds() === second
  );
}

function importSource(value: unknown, path: string): ManuscriptImportSourceWireV1 {
  const source = wireRecord(value, path);
  const version = wireInteger(source.version, `${path}.version`, { min: 1, max: 2 });
  const fileName = wireString(source.fileName, `${path}.fileName`, { min: 1, max: 1000 });
  if (!fileName.trim()) throw new WireContractError(`${path}.fileName`);
  const format = wireEnum(source.format, ["docx", "markdown", "txt"] as const, `${path}.format`);
  if (version === 1 && format !== "docx") throw new WireContractError(`${path}.format`);
  const sourceSha256 = wireString(source.sourceSha256, `${path}.sourceSha256`, {
    min: 64,
    max: 64,
  });
  if (!/^[a-f0-9]{64}$/.test(sourceSha256)) throw new WireContractError(`${path}.sourceSha256`);
  const importedAt = wireString(source.importedAt, `${path}.importedAt`, { min: 20, max: 40 });
  if (!isValidUtcTimestamp(importedAt)) {
    throw new WireContractError(`${path}.importedAt`);
  }
  const counts = wireRecord(source.counts, `${path}.counts`);
  const canonicalCounts = {
    ...counts,
    sourceWords: wireInteger(counts.sourceWords, `${path}.counts.sourceWords`, { min: 0 }),
    sourceParagraphs: wireInteger(counts.sourceParagraphs, `${path}.counts.sourceParagraphs`, {
      min: 0,
    }),
    importedWords: wireInteger(counts.importedWords, `${path}.counts.importedWords`, { min: 0 }),
    importedParagraphs: wireInteger(
      counts.importedParagraphs,
      `${path}.counts.importedParagraphs`,
      { min: 0 },
    ),
  };
  const seenWarnings = new Set<string>();
  const warnings = wireArray(source.warnings, `${path}.warnings`).map((value, index) => {
    const warningPath = `${path}.warnings[${index}]`;
    const warning = wireRecord(value, warningPath);
    const code = wireEnum(warning.code, importWarningCodes, `${warningPath}.code`);
    if (seenWarnings.has(code)) throw new WireContractError(`${warningPath}.code`);
    seenWarnings.add(code);
    return {
      ...warning,
      code,
      count: wireInteger(warning.count, `${warningPath}.count`, { min: 1 }),
    };
  });
  return {
    ...source,
    version,
    fileName,
    format,
    sourceSha256,
    importedAt,
    counts: canonicalCounts,
    warnings,
  } as ManuscriptImportSourceWireV1;
}

function cloneImportSource(
  source: ManuscriptImportSourceWireV1 | undefined,
): ManuscriptImportSourceWireV1 | undefined {
  return source
    ? {
        ...source,
        counts: { ...source.counts },
        warnings: source.warnings.map((warning) => ({ ...warning })),
      }
    : undefined;
}

/** V1 editor offsets are UTF-16 code units and may not split a surrogate pair. */
function isUtf16Boundary(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return true;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}

function manuscriptPayload(value: unknown, path: string): ManuscriptPayloadWireV1 {
  const payload = wireRecord(value, path);
  const canonicalImportSource =
    payload.importSource === undefined
      ? undefined
      : importSource(payload.importSource, `${path}.importSource`);
  const chapters = wireArray(payload.chapters, `${path}.chapters`);
  const chapterIds = new Set<string>();
  const canonicalNoteMarks: Array<NoteMarkWireV1[] | undefined> = [];
  for (const [index, chapterValue] of chapters.entries()) {
    const chapterPath = `${path}.chapters[${index}]`;
    const chapter = wireRecord(chapterValue, chapterPath);
    const id = wireString(chapter.id, `${chapterPath}.id`, { min: 1, max: 200 });
    if (chapterIds.has(id)) throw new WireContractError(`${chapterPath}.id`);
    chapterIds.add(id);
    optional(chapter, "inBook", wireBoolean, chapterPath);
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
    canonicalNoteMarks.push(
      chapter.noteMarks === undefined
        ? undefined
        : validateNoteMarks(chapter.noteMarks, note, `${chapterPath}.noteMarks`),
    );
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

  const canonicalTrash: ChapterTrashEntryWireV1[] | undefined =
    payload.trash === undefined
      ? undefined
      : wireArray(payload.trash, `${path}.trash`).map((entryValue, index) => {
          const entryPath = `${path}.trash[${index}]`;
          const entry = wireRecord(entryValue, entryPath);
          const deletedAt = wireString(entry.deletedAt, `${entryPath}.deletedAt`, {
            min: 20,
            max: 40,
          });
          if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(deletedAt)) {
            throw new WireContractError(`${entryPath}.deletedAt`);
          }
          const canonicalChapter = manuscriptPayload(
            { chapters: [entry.chapter] },
            `${entryPath}.chapterEnvelope`,
          ).chapters[0];
          const chapterId = canonicalChapter.id;
          if (chapterIds.has(chapterId)) throw new WireContractError(`${entryPath}.chapter.id`);
          const previousTrash = payload.trash as unknown[];
          if (
            previousTrash.slice(0, index).some((candidate) => {
              const record = candidate as { chapter?: { id?: unknown } };
              return record.chapter?.id === chapterId;
            })
          ) {
            throw new WireContractError(`${entryPath}.chapter.id`);
          }
          const treeItem = wireRecord(entry.treeItem, `${entryPath}.treeItem`);
          if (
            wireEnum(treeItem.kind, ["chapter"] as const, `${entryPath}.treeItem.kind`) !==
              "chapter" ||
            wireString(treeItem.chapterId, `${entryPath}.treeItem.chapterId`, {
              min: 1,
              max: 200,
            }) !== chapterId ||
            treeItem.folderId !== undefined
          ) {
            throw new WireContractError(`${entryPath}.treeItem`);
          }
          wireString(treeItem.id, `${entryPath}.treeItem.id`, { min: 1, max: 500 });
          wireInteger(treeItem.position, `${entryPath}.treeItem.position`, { min: 0 });
          optional(
            treeItem,
            "parentFolderId",
            (item, itemPath) => wireString(item, itemPath, { min: 1, max: 200 }),
            `${entryPath}.treeItem`,
          );
          const originalFolderPathValues = wireArray(
            entry.originalFolderPath,
            `${entryPath}.originalFolderPath`,
          );
          if (originalFolderPathValues.length > 100) {
            throw new WireContractError(`${entryPath}.originalFolderPath`);
          }
          const folderIds = new Set<string>();
          const originalFolderPath = originalFolderPathValues.map((folderValue, folderIndex) => {
            const folderPath = `${entryPath}.originalFolderPath[${folderIndex}]`;
            const folder = wireRecord(folderValue, folderPath);
            const folderId = wireString(folder.id, `${folderPath}.id`, { min: 1, max: 200 });
            if (folderIds.has(folderId)) throw new WireContractError(`${folderPath}.id`);
            folderIds.add(folderId);
            wireString(folder.title, `${folderPath}.title`, { max: 1000 });
            return folder as ChapterFolderWireV1;
          });
          const originalParent = treeItem.parentFolderId;
          if (
            (originalParent === undefined && originalFolderPath.length > 0) ||
            (originalParent !== undefined && originalFolderPath.at(-1)?.id !== originalParent)
          ) {
            throw new WireContractError(`${entryPath}.originalFolderPath`);
          }
          return {
            ...entry,
            chapter: canonicalChapter,
            deletedAt,
            originalFolderPath,
            treeItem: treeItem as ChapterTrashEntryWireV1["treeItem"],
          };
        });
  if (canonicalTrash && canonicalTrash.length > 1000) {
    throw new WireContractError(`${path}.trash`);
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
  optional(payload, "bookLayout", validateBookLayoutV1, path);
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
  for (const field of ["activeSymbols", "hiddenElements"] as const) {
    if (payload[field] === undefined) continue;
    for (const [index, entry] of wireArray(payload[field], `${path}.${field}`).entries()) {
      wireString(entry, `${path}.${field}[${index}]`);
    }
  }
  return {
    ...payload,
    ...(canonicalImportSource === undefined ? {} : { importSource: canonicalImportSource }),
    chapters: chapters.map((chapter, index) => ({
      ...wireRecord(chapter, `${path}.chapters[${index}]`),
      ...(canonicalNoteMarks[index] === undefined ? {} : { noteMarks: canonicalNoteMarks[index] }),
    })),
    ...(canonicalTrash === undefined ? {} : { trash: canonicalTrash }),
  } as unknown as ManuscriptPayloadWireV1;
}

function cloneChapter(wire: ChapterWireV1): ChapterWireV1 {
  const chapter = { ...wire };
  chapter.noteReferences = cloneNoteReferences(wire.noteReferences);
  chapter.noteMarks = cloneNoteMarks(wire.noteMarks);
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
    noteMarks: cloneNoteMarks(chapter.noteMarks),
    storyTime: chapter.storyTime ? { ...chapter.storyTime } : undefined,
    mentions: chapter.mentions?.map((mention) => ({ ...mention })),
    marks: chapter.marks?.map((mark) => ({ ...mark })),
  };
}

export function decodeManuscriptV1(value: unknown): DecodedDocumentV1<Manuscript> {
  const wire = decodeDocumentEnvelopeV1(value, "quiltor.manuscript", manuscriptPayload);
  const { trash: wireTrash, ...payloadWithoutTrash } = wire.payload;
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
      ...payloadWithoutTrash,
      importSource: cloneImportSource(wire.payload.importSource),
      bookLayout: cloneBookLayoutV1(wire.payload.bookLayout),
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
      ...(wireTrash === undefined
        ? {}
        : {
            trash: wireTrash.map((entry) => ({
              ...entry,
              chapter: {
                ...cloneChapter(entry.chapter),
                title: entry.chapter.title ?? "",
                body: entry.chapter.body ?? "",
                note: entry.chapter.note ?? "",
              },
              originalFolderPath: entry.originalFolderPath.map((folder) => ({ ...folder })),
              treeItem: { ...entry.treeItem, kind: "chapter" as const },
            })),
          }),
    },
    revision: wire.revision,
  };
}

export function encodeManuscriptV1(model: Manuscript, revision?: number): ManuscriptWireV1 {
  const payload = {
    ...model,
    importSource: cloneImportSource(model.importSource),
    bookLayout: cloneBookLayoutV1(model.bookLayout),
    chapters: model.chapters.map(encodeChapter),
    ...(model.trash === undefined
      ? {}
      : {
          trash: model.trash.map((entry) => ({
            ...entry,
            chapter: encodeChapter(entry.chapter),
            originalFolderPath: entry.originalFolderPath.map((folder) => ({ ...folder })),
            treeItem: { ...entry.treeItem },
          })),
        }),
  } as ManuscriptPayloadWireV1;
  return encodeDocumentEnvelopeV1("quiltor.manuscript", payload, revision, manuscriptPayload);
}
