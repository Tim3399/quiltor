import { describe, expect, it } from "vitest";
import { de } from "../../../../../locales/de";
import type { MessageKey } from "../../i18n";
import type { FigureState } from "../story-world";
import { applyAssistantProposals } from "./proposals";

const t = (key: MessageKey) => de[key];

describe("assistant proposals", () => {
  it("creates linked elements, a moment and a temporal relationship without touching manuscript data", () => {
    const result = applyAssistantProposals(
      { nodes: [], edges: [] },
      [
        { kind: "create_element", tempId: "new:a", element: { name: "Ada", type: "person" } },
        { kind: "create_element", tempId: "new:b", element: { name: "Bela", type: "person" } },
        { kind: "create_timeline_moment", tempId: "new:m", moment: { title: "Begegnung" } },
        {
          kind: "create_relationship",
          relationship: { from: "new:a", to: "new:b", label: "Misstrauen", directed: false },
        },
        { kind: "mark_deceased", elementId: "new:b", momentId: "new:m" },
      ],
      t,
    );
    expect(result.nodes.map((node) => node.name)).toEqual(["Ada", "Bela"]);
    expect(result.edges[0]).toMatchObject({
      label: "Misstrauen",
      gerichtet: false,
      lineStyle: "solid",
      relationshipKind: "general",
      color: "auto",
    });
    expect(result.edges[0]).not.toHaveProperty("style");
    expect(result.nodes[1].diedMomentId).toBe(result.timeline?.[0].id);
  });

  it("writes modern relationship appearance and migrates legacy assistant styles", () => {
    const base: FigureState = {
      nodes: [
        { id: "a", x: 0, y: 0, name: "Ada", type: "person" },
        { id: "b", x: 0, y: 0, name: "Bela", type: "person" },
      ],
      edges: [],
    };
    const modern = applyAssistantProposals(
      base,
      [
        {
          kind: "create_relationship",
          relationship: {
            from: "a",
            to: "b",
            lineStyle: "dotted",
            relationshipKind: "kinship",
            color: "rose",
          },
        },
      ],
      t,
    );
    expect(modern.edges[0]).toMatchObject({
      lineStyle: "dotted",
      relationshipKind: "kinship",
      color: "rose",
    });
    expect(modern.edges[0]).not.toHaveProperty("style");

    const legacy = applyAssistantProposals(
      base,
      [{ kind: "create_relationship", relationship: { from: "a", to: "b", style: "blood" } }],
      t,
    );
    expect(legacy.edges[0]).toMatchObject({
      lineStyle: "solid",
      relationshipKind: "kinship",
      color: "auto",
    });
    expect(legacy.edges[0]).not.toHaveProperty("style");
  });

  it("preserves resolved modern appearance in temporal relationship proposals", () => {
    const state: FigureState = {
      nodes: [],
      edges: [
        {
          id: "bond",
          from: "a",
          to: "b",
          lineStyle: "solid",
          relationshipKind: "general",
          color: "rose",
          versions: [
            {
              momentId: "early",
              active: true,
              lineStyle: "dashed",
              relationshipKind: "kinship",
              color: "blue",
            },
          ],
        },
      ],
      timeline: [
        { id: "early", title: "Früh" },
        { id: "late", title: "Spät" },
      ],
    };
    const result = applyAssistantProposals(
      state,
      [
        {
          kind: "set_relationship_at_moment",
          relationshipId: "bond",
          momentId: "late",
          patch: { label: "Familie" },
        },
      ],
      t,
    );
    expect(result.edges[0].versions?.find((version) => version.momentId === "late")).toMatchObject({
      label: "Familie",
      lineStyle: "dashed",
      relationshipKind: "kinship",
      color: "blue",
    });
  });

  it("arranges connected thematic groups without losing elements or relationships", () => {
    const state = {
      nodes: [
        { id: "a", x: 700, y: 500, type: "person" as const, name: "Ada" },
        { id: "b", x: 720, y: 520, type: "person" as const, name: "Bela" },
        { id: "c", x: 740, y: 540, type: "ort" as const, name: "Cella" },
      ],
      edges: [{ id: "e", from: "a", to: "b", label: "Verbündet" }],
    };
    const result = applyAssistantProposals(
      state,
      [{ kind: "arrange_elements", strategy: "thematic" }],
      t,
    );
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toEqual(state.edges);
    expect(new Set(result.nodes.map((node) => `${node.x}:${node.y}`)).size).toBe(3);
  });

  it("replaces presence only at the proposed base or timeline state", () => {
    const state = {
      nodes: [
        { id: "mara", x: 0, y: 0, name: "Mara", type: "person" as const },
        { id: "hafen", x: 0, y: 0, name: "Hafen", type: "ort" as const },
        { id: "archiv", x: 0, y: 0, name: "Archiv", type: "ort" as const },
      ],
      edges: [],
      timeline: [{ id: "trial", title: "Prozess" }],
      presence: [
        { id: "old-base", elementId: "mara", placeId: "hafen" },
        { id: "old-trial", elementId: "mara", placeId: "hafen", momentId: "trial" },
      ],
    };
    const result = applyAssistantProposals(
      state,
      [{ kind: "set_presence", elementId: "mara", placeId: "archiv", momentId: "trial" }],
      t,
    );
    expect(result.presence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "old-base", placeId: "hafen" }),
        expect.objectContaining({ elementId: "mara", placeId: "archiv", momentId: "trial" }),
      ]),
    );
    expect(result.presence).not.toContainEqual(expect.objectContaining({ id: "old-trial" }));
  });

  it("keeps note text and references when an element update omits notizen", () => {
    const state: FigureState = {
      nodes: [
        {
          id: "mara",
          x: 0,
          y: 0,
          name: "Mara",
          type: "person",
          profile: {
            fields: [
              {
                id: "profile-field:mara:legacy:rolle",
                key: "Rolle in der Geschichte",
                value: "Zeugin",
              },
            ],
            notizen: "Mara kennt das Archiv.",
            noteReferences: [
              {
                id: "ref-archive",
                target: { kind: "place", id: "archive" },
                from: 15,
                to: 21,
                surface: "Archiv",
              },
            ],
            noteMarks: [{ from: 0, to: 4, kind: "bold" }],
          },
        },
      ],
      edges: [],
    };

    const result = applyAssistantProposals(
      state,
      [{ kind: "update_element", elementId: "mara", patch: { profile: { rolle: "Heldin" } } }],
      t,
    );

    expect(result.nodes[0].profile).toMatchObject({
      fields: [
        {
          id: "profile-field:mara:legacy:rolle",
          key: "Rolle in der Geschichte",
          value: "Heldin",
        },
      ],
      notizen: "Mara kennt das Archiv.",
      noteReferences: state.nodes[0].profile?.noteReferences,
      noteMarks: state.nodes[0].profile?.noteMarks,
    });
  });

  it("reconciles note references atomically when an element update changes notizen", () => {
    const state: FigureState = {
      nodes: [
        {
          id: "mara",
          x: 0,
          y: 0,
          name: "Mara",
          type: "person",
          profile: {
            notizen: "Mara kennt das Archiv.",
            noteReferences: [
              {
                id: "ref-archive",
                target: { kind: "place", id: "archive" },
                from: 15,
                to: 21,
                surface: "Archiv",
              },
            ],
            noteMarks: [{ from: 0, to: 4, kind: "bold" }],
          },
        },
      ],
      edges: [],
    };

    const result = applyAssistantProposals(
      state,
      [
        {
          kind: "update_element",
          elementId: "mara",
          patch: { profile: { notizen: "Mara kennt das neue Archiv." } },
        },
      ],
      t,
    );

    expect(result.nodes[0].profile).toMatchObject({
      notizen: "Mara kennt das neue Archiv.",
      noteReferences: [],
      noteMarks: [],
    });
  });

  it("merges canonical profile fields without duplicate ids or losing extensions", () => {
    const state: FigureState = {
      nodes: [
        {
          id: "mara",
          x: 0,
          y: 0,
          name: "Mara",
          profile: {
            fields: [{ id: "role", key: "Rolle", value: "Zeugin", source: "manual" }],
          },
        },
      ],
      edges: [],
    };

    const result = applyAssistantProposals(
      state,
      [
        {
          kind: "update_element",
          elementId: "mara",
          patch: {
            profile: {
              fields: [
                { id: " role ", key: "Rolle", value: "Heldin" },
                { id: "role", key: "Doppelt", value: "Ignorieren" },
                { id: "   ", key: "Leer", value: "Ignorieren" },
              ],
            },
          },
        },
      ],
      t,
    );

    expect(result.nodes[0].profile?.fields).toEqual([
      { id: "role", key: "Rolle", value: "Heldin", source: "manual" },
    ]);
  });
});
