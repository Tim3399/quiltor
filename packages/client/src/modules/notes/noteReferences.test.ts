import { describe, expect, it } from "vitest";
import type { NoteReference, WorldReferenceCandidate } from "../world-references";
import {
  findActiveNoteReferenceQuery,
  insertNoteReference,
  mapNoteReferences,
  reconcileNoteReferences,
} from "./noteReferences";

const candidate = (
  label = "Anna-Lena",
  target: WorldReferenceCandidate["target"] = { kind: "entity", id: "anna" },
): WorldReferenceCandidate => ({
  id: `${target.kind}:${target.id}`,
  target,
  label,
  detail: "Figur",
  keywords: [],
  workspace: target.kind === "place" ? "places" : target.kind === "chapter" ? "text" : "figures",
});

const reference = (
  id: string,
  from: number,
  to: number,
  surface: string,
  target: NoteReference["target"] = { kind: "entity", id },
): NoteReference => ({ id, target, from, to, surface });

function activeQuery(text: string, caret: number) {
  const query = findActiveNoteReferenceQuery(text, caret);
  if (!query) throw new Error("Expected an active note reference query in this fixture.");
  return query;
}

describe("active note reference query", () => {
  it("finds an empty or partially typed Unicode name directly before the caret", () => {
    expect(findActiveNoteReferenceQuery("Treffe @", 8)).toEqual({ from: 7, to: 8, query: "" });
    expect(findActiveNoteReferenceQuery("Treffe @Änne-L", 14)).toEqual({
      from: 7,
      to: 14,
      query: "Änne-L",
    });
  });

  it("uses textarea UTF-16 offsets around astral characters", () => {
    const text = "😀 @Anna";
    expect(text.length).toBe(8);
    expect(findActiveNoteReferenceQuery(text, text.length)).toEqual({
      from: 3,
      to: 8,
      query: "Anna",
    });
    expect(findActiveNoteReferenceQuery(text, 1)).toBeNull();
  });

  it("rejects embedded handles, email fragments, whitespace, punctuation, and invalid carets", () => {
    expect(findActiveNoteReferenceQuery("foo@bar", 7)).toBeNull();
    expect(findActiveNoteReferenceQuery("foo@@bar", 8)).toBeNull();
    expect(findActiveNoteReferenceQuery("@Anna Lena", 10)).toBeNull();
    expect(findActiveNoteReferenceQuery("@Anna,", 6)).toBeNull();
    expect(findActiveNoteReferenceQuery("@Anna\n", 6)).toBeNull();
    expect(findActiveNoteReferenceQuery("@Anna", 0)).toBeNull();
    expect(findActiveNoteReferenceQuery("@Anna", -1)).toBeNull();
    expect(findActiveNoteReferenceQuery("@Anna", 99)).toBeNull();
    expect(findActiveNoteReferenceQuery("@Anna", 1.5)).toBeNull();
  });

  it("accepts a query after punctuation without confusing the punctuation with the query", () => {
    expect(findActiveNoteReferenceQuery("(@Mára.O'Neil", 13)).toEqual({
      from: 1,
      to: 13,
      query: "Mára.O'Neil",
    });
  });
});

describe("note reference insertion", () => {
  it("replaces the query with a visible label and stores a stable target ID", () => {
    const text = "Treffe @ann morgen.";
    const query = activeQuery(text, 11);
    const result = insertNoteReference(text, [], query, candidate(), () => "reference-1");

    expect(result).toEqual({
      text: "Treffe Anna-Lena morgen.",
      caret: 16,
      references: [
        {
          id: "reference-1",
          target: { kind: "entity", id: "anna" },
          from: 7,
          to: 16,
          surface: "Anna-Lena",
        },
      ],
    });
  });

  it("maps surrounding references and invalidates a reference overlapping the query", () => {
    const text = "Mara trifft @an bei Bela";
    const references = [
      reference("mara", 0, 4, "Mara"),
      reference("stale", 12, 15, "@an"),
      reference("bela", 20, 24, "Bela"),
    ];
    const query = activeQuery(text, 15);
    const result = insertNoteReference(text, references, query, candidate("Anna"), () => "anna");

    expect(result.text).toBe("Mara trifft Anna bei Bela");
    expect(result.references.map(({ id, from, to }) => [id, from, to])).toEqual([
      ["mara", 0, 4],
      ["anna", 12, 16],
      ["bela", 21, 25],
    ]);
  });

  it("counts astral label characters in the same UTF-16 offsets as a textarea", () => {
    const text = "Sieht @dr";
    const query = activeQuery(text, text.length);
    const result = insertNoteReference(
      text,
      [],
      query,
      candidate("🐉 Drache", { kind: "entity", id: "dragon" }),
      () => "dragon-ref",
    );

    expect(result.text).toBe("Sieht 🐉 Drache");
    expect(result.caret).toBe(result.text.length);
    expect(result.references[0]).toMatchObject({ from: 6, to: 15, surface: "🐉 Drache" });
  });

  it("shortens extreme labels without splitting an astral character", () => {
    const text = "Sieht @dr";
    const query = activeQuery(text, text.length);
    const label = `${"a".repeat(998)}🐉${"b".repeat(20)}`;
    const result = insertNoteReference(text, [], query, candidate(label), () => "long-ref");

    expect(result.references[0].surface).toHaveLength(999);
    expect(result.references[0].surface).toBe(`${"a".repeat(998)}…`);
    expect(result.text.slice(result.references[0].from, result.references[0].to)).toBe(
      result.references[0].surface,
    );
  });

  it("rejects stale queries, blank labels, invalid targets, and duplicate IDs", () => {
    const text = "@ann Bela";
    const query = activeQuery(text, 4);
    expect(() =>
      insertNoteReference("X@ann Bela", [], query, candidate(), () => "ref"),
    ).toThrowError(RangeError);
    expect(() => insertNoteReference(text, [], query, candidate("   "), () => "ref")).toThrowError(
      RangeError,
    );
    expect(() =>
      insertNoteReference(
        text,
        [],
        query,
        candidate("Anna", { kind: "entity", id: "" }),
        () => "ref",
      ),
    ).toThrowError(RangeError);
    expect(() =>
      insertNoteReference(
        text,
        [reference("ref", 5, 9, "Bela")],
        query,
        candidate("Anna"),
        () => "ref",
      ),
    ).toThrowError(/unique/);
  });
});

describe("note reference mapping", () => {
  it("shifts references after insertions, replacements, and deletions before them", () => {
    const refs = [reference("mara", 4, 8, "Mara")];
    expect(mapNoteReferences(refs, "Die Mara", "Oh, die Mara")[0]).toMatchObject({
      from: 8,
      to: 12,
    });
    expect(mapNoteReferences(refs, "Die Mara", "Dort Mara")[0]).toMatchObject({
      from: 5,
      to: 9,
    });
    expect(mapNoteReferences(refs, "Die Mara", "Mara")[0]).toMatchObject({ from: 0, to: 4 });
  });

  it("keeps boundary insertions but invalidates insertions strictly inside a reference", () => {
    const refs = [reference("mara", 4, 8, "Mara")];
    expect(mapNoteReferences(refs, "Die Mara", "Die XMara")[0]).toMatchObject({
      from: 5,
      to: 9,
    });
    expect(mapNoteReferences(refs, "Die Mara", "Die Mara!")[0]).toMatchObject({
      from: 4,
      to: 8,
    });
    expect(mapNoteReferences(refs, "Die Mara", "Die MaXra")).toEqual([]);
  });

  it("invalidates deletions and replacements that overlap either side of a reference", () => {
    const refs = [reference("mara", 4, 8, "Mara")];
    expect(mapNoteReferences(refs, "Die Mara", "Die Mra")).toEqual([]);
    expect(mapNoteReferences(refs, "Die Mara", "DieXara")).toEqual([]);
    expect(mapNoteReferences(refs, "Die Mara", "Die MarX")).toEqual([]);
  });

  it("leaves references unchanged when the edit is after them or text is unchanged", () => {
    const refs = [reference("mara", 0, 4, "Mara")];
    expect(mapNoteReferences(refs, "Mara geht", "Mara geht fort")).toEqual(refs);
    expect(mapNoteReferences(refs, "Mara", "Mara")).toEqual(refs);
  });

  it("expands a code-unit diff to UTF-16 boundaries before mapping", () => {
    const refs = [reference("mara", 2, 6, "Mara")];
    expect(mapNoteReferences(refs, "😀Mara", "😁Mara")[0]).toMatchObject({
      from: 2,
      to: 6,
    });
    expect(mapNoteReferences(refs, "😀Mara", "xMara")[0]).toMatchObject({
      from: 1,
      to: 5,
    });
    expect(
      mapNoteReferences([reference("mara", 1, 5, "Mara")], "xMara", "😀Mara")[0],
    ).toMatchObject({ from: 2, to: 6 });
  });

  it("conservatively drops a reference between two edits represented as one replacement", () => {
    const refs = [reference("mara", 2, 6, "Mara")];
    expect(mapNoteReferences(refs, "x Mara y", "z Mara q")).toEqual([]);
  });
});

describe("note reference reconciliation", () => {
  it("sorts valid adjacent references without changing their stable targets", () => {
    const refs = [
      reference("bela-ref", 5, 9, "Bela", { kind: "entity", id: "bela" }),
      reference("mara-ref", 0, 4, "Mara", { kind: "entity", id: "mara" }),
    ];
    expect(reconcileNoteReferences("Mara Bela", refs)).toEqual([refs[1], refs[0]]);
  });

  it("removes malformed, out-of-bounds, surface-mismatched, duplicate, and overlapping refs", () => {
    const refs: NoteReference[] = [
      reference("ok", 0, 4, "Mara"),
      reference("overlap", 2, 6, "ra B"),
      reference("duplicate", 5, 9, "Bela"),
      reference("duplicate", 10, 14, "geht"),
      reference("mismatch", 5, 9, "Anna"),
      reference("backwards", 5, 4, "x"),
      reference("outside", 20, 24, "fort"),
      reference("", 5, 9, "Bela"),
      reference("no-target", 5, 9, "Bela", { kind: "entity", id: "" }),
    ];
    expect(reconcileNoteReferences("Mara Bela geht", refs).map((item) => item.id)).toEqual([
      "ok",
      "duplicate",
    ]);
  });

  it("rejects ranges that split a UTF-16 surrogate pair", () => {
    const refs = [
      reference("whole", 0, 2, "😀"),
      reference("split-start", 1, 2, "\ude00"),
      reference("split-end", 0, 1, "\ud83d"),
    ];
    expect(reconcileNoteReferences("😀", refs).map((item) => item.id)).toEqual(["whole"]);
  });
});
