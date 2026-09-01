import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  api,
  askQuestion,
  CHAPTERS,
  preferences,
  reply,
  setup,
} from "./AssistantDrawer.testSupport";

describe("assistant conversation content", () => {
  it("applies one proposal and records its applied state", async () => {
    const proposals = [
      { kind: "create_element" as const, tempId: "new:igor", element: { name: "Igor" } },
    ];
    vi.mocked(api.chat).mockResolvedValue(reply({ proposals }));
    const { onApply } = setup();
    await screen.findByText("Was soll ich in der Welt nachtragen?");
    await askQuestion("Lege Igor an.");
    fireEvent.click(await screen.findByText("Übernehmen"));
    expect(onApply).toHaveBeenCalledWith([
      expect.objectContaining({
        kind: "create_element",
        element: { name: "Igor" },
        tempId: expect.stringMatching(/^new:.+:igor$/),
      }),
    ]);
    expect(await screen.findByText("Übernommen")).toBeInTheDocument();
  });

  it("only permits applying grouped proposals atomically", async () => {
    const proposals = [
      { kind: "create_element" as const, tempId: "new:igor", element: { name: "Igor" } },
      {
        kind: "create_relationship" as const,
        relationship: { from: "tarek", to: "new:igor", label: "Vater von" },
      },
    ];
    vi.mocked(api.chat).mockResolvedValue(
      reply({
        proposals,
        proposalGroup: { id: "task", title: "Igor anlegen", proposalIndexes: [0, 1] },
      }),
    );
    setup();
    await screen.findByText("Was soll ich in der Welt nachtragen?");
    await askQuestion("Lege Igor als Sohn von Tarek an.");
    const individualButtons = await screen.findAllByText("Im Paket");
    expect(individualButtons).toHaveLength(2);
    expect(individualButtons[0].closest("button")).toBeDisabled();
    expect(screen.getByText("Alle übernehmen").closest("button")).not.toBeDisabled();
  });

  it("navigates from a source to its owned workspace target", async () => {
    vi.mocked(api.chat).mockResolvedValue(
      reply({
        sources: [
          {
            id: "element:tarek",
            kind: "element",
            contextClass: "canon",
            title: "Tarek Venn",
            text: "...",
            target: { workspace: "figures", id: "tarek" },
          },
        ],
      }),
    );
    const { onNavigate } = setup();
    await screen.findByText("Was soll ich in der Welt nachtragen?");
    await askQuestion("Wer ist Tarek?");
    fireEvent.click(await screen.findByText("Tarek Venn"));
    expect(onNavigate).toHaveBeenCalledWith({ workspace: "figures", id: "tarek" });
  });

  it("marks Storyboard sources as planning context and navigates to the exact card", async () => {
    vi.mocked(api.chat).mockResolvedValue(
      reply({
        sources: [
          {
            id: "storyboard:turning-point",
            kind: "storyboard",
            contextClass: "planning",
            title: "Wendepunkt",
            text: "Mögliche Wendung",
            target: {
              workspace: "storyboard",
              id: "turning-point",
              boardId: "plot-board",
            },
          },
        ],
      }),
    );
    const { onNavigate } = setup();
    await screen.findByText("Was soll ich in der Welt nachtragen?");
    await askQuestion("Welche Wendung ist geplant?");

    fireEvent.click(await screen.findByText("Quellen · 1"));
    expect(await screen.findByText("Planung")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Planungsquelle öffnen: Wendepunkt" }));
    expect(onNavigate).toHaveBeenCalledWith({
      workspace: "storyboard",
      id: "turning-point",
      boardId: "plot-board",
    });
  });

  it("labels the whole answer as non-canon when planning context contributed", async () => {
    vi.mocked(api.chat).mockResolvedValue(reply({ contextClassesUsed: ["canon", "planning"] }));
    setup();
    await screen.findByText("Was soll ich in der Welt nachtragen?");
    await askQuestion("Welche Ideen sind noch offen?");

    expect(
      await screen.findByRole("note", { name: "Storyboard-Planung · nicht Kanon" }),
    ).toBeVisible();
  });

  it("sends a selected clarification candidate as an explicit follow-up", async () => {
    vi.mocked(api.chat)
      .mockResolvedValueOnce(
        reply({
          message: "Welches Element meinst du?",
          clarification: { candidates: [{ id: "tarek", name: "Tarek Venn", kind: "person" }] },
        }),
      )
      .mockResolvedValueOnce(reply({ message: "Eindeutig." }));
    setup();
    await screen.findByText("Was soll ich in der Welt nachtragen?");
    await askQuestion("Ergänze sein Profil.");
    fireEvent.click(await screen.findByRole("button", { name: "Tarek Venn" }));
    await screen.findByText("Eindeutig.");
    expect(vi.mocked(api.chat).mock.calls[1][0]).toContain("[tarek]");
  });

  it("adds source ids as machine-readable history references", async () => {
    vi.mocked(api.chat)
      .mockResolvedValueOnce(
        reply({
          sources: [
            {
              id: "element:tarek",
              kind: "element",
              contextClass: "canon",
              title: "Tarek",
              text: "",
              target: { workspace: "figures", id: "tarek" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(reply());
    setup();
    await screen.findByText("Was soll ich in der Welt nachtragen?");
    await askQuestion("Wer ist Tarek?");
    await screen.findByText("Tarek");
    await askQuestion("Und sein Profil?");
    expect(vi.mocked(api.chat).mock.calls[1][1]).toContainEqual(
      expect.objectContaining({ role: "assistant", references: ["element:tarek"] }),
    );
  });

  it("flushes document autosaves before the assistant job snapshots them", async () => {
    let finishFlush: (() => void) | undefined;
    const onBeforeSend = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishFlush = resolve;
        }),
    );
    vi.mocked(api.chat).mockResolvedValue(reply());
    setup("world-1", CHAPTERS, true, onBeforeSend);
    await screen.findByText("Was soll ich in der Welt nachtragen?");
    await askQuestion("Was ist auf dem Storyboard geplant?");

    await waitFor(() => expect(onBeforeSend).toHaveBeenCalledTimes(1));
    expect(api.chat).not.toHaveBeenCalled();
    finishFlush?.();
    await waitFor(() => expect(api.chat).toHaveBeenCalledTimes(1));
  });

  it("persists transcripts per world", async () => {
    vi.mocked(api.chat).mockResolvedValue(reply({ message: "Gemerkt." }));
    const { unmount } = setup("world-a");
    await screen.findByText("Was soll ich in der Welt nachtragen?");
    await askQuestion("Wer ist Tarek?");
    await screen.findByText("Gemerkt.");
    unmount();

    setup("world-a");
    expect(await screen.findByText("Wer ist Tarek?")).toBeInTheDocument();
    cleanup();

    setup("world-b");
    expect(await screen.findByText("Was soll ich in der Welt nachtragen?")).toBeInTheDocument();
  });

  it("clears the persisted transcript after new-chat confirmation", async () => {
    vi.mocked(api.chat).mockResolvedValue(reply({ message: "Gemerkt." }));
    setup("world-clear");
    await screen.findByText("Was soll ich in der Welt nachtragen?");
    await askQuestion("Wer ist Tarek?");
    await screen.findByText("Gemerkt.");
    fireEvent.click(screen.getByLabelText("Neuer Chat"));
    fireEvent.click(screen.getByText("Neuer Chat starten"));
    expect(await screen.findByText("Was soll ich in der Welt nachtragen?")).toBeInTheDocument();
    expect(JSON.parse(preferences.get("quiltor-assistant:world-clear") || "[]")).toEqual([]);
  });

  it("sends selected chapter ids and exposes their count in the summary", async () => {
    vi.mocked(api.chat).mockResolvedValue(reply());
    setup();
    await screen.findByText("Was soll ich in der Welt nachtragen?");
    const trigger = screen.getByRole("button", { name: "Kontext: gesamte Welt" });
    fireEvent.click(trigger);
    const picker = screen.getByRole("dialog", { name: "Kapitel einzeln auswählen" });
    const chapter = within(picker).getByRole("checkbox", { name: "1. Die Krönung" });
    await waitFor(() => expect(chapter).toHaveFocus());
    fireEvent.click(chapter);
    expect(screen.getByText("Kontext: Kapitelauswahl (1)")).toBeInTheDocument();
    fireEvent.keyDown(picker, { key: "Escape" });
    await waitFor(() => expect(picker).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    await askQuestion("Fasse das zusammen.");
    expect(vi.mocked(api.chat).mock.calls[0][3]).toEqual(["c1"]);
  });

  it("omits the chapter picker when there are no manuscript chapters", async () => {
    setup("world-empty", []);
    await screen.findByText("Was soll ich in der Welt nachtragen?");
    expect(screen.queryByText("Kontext: gesamte Welt")).not.toBeInTheDocument();
  });

  it("requires epistemic review before an extracted statement becomes canon", async () => {
    const proposal = {
      kind: "create_element" as const,
      tempId: "new:nova",
      element: { name: "Nova" },
    };
    vi.mocked(api.chat).mockResolvedValue(
      reply({
        mode: "world_extraction",
        proposals: [proposal],
        proposalGroups: [{ id: "elements", proposalIndexes: [0] }],
        proposalEnvelopes: [
          {
            proposal,
            claimStatus: "unresolved",
            evidence: [
              {
                id: "chapter:c1:0",
                kind: "chapter",
                contextClass: "manuscript",
                title: "Die Krönung",
                text: "Nova kommt.",
                target: { workspace: "text", id: "c1" },
              },
            ],
          },
        ],
      }),
    );
    const { onApply } = setup();
    await screen.findByText("Was soll ich in der Welt nachtragen?");
    fireEvent.click(
      screen.getByRole("button", { name: "Weltmodell aus Manuskript aktualisieren" }),
    );

    const apply = await screen.findByRole("button", { name: "Übernehmen" });
    expect(apply).toBeDisabled();
    expect(screen.getByText("Belege · 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: "Aussage einordnen" }));
    fireEvent.click(await screen.findByRole("option", { name: "Objektiver Weltfakt" }));
    expect(apply).not.toBeDisabled();
    fireEvent.click(apply);

    expect(onApply).toHaveBeenCalledWith([
      expect.objectContaining({ kind: "create_element", element: { name: "Nova" } }),
    ]);
  });

  it("edits a proposal before applying it", async () => {
    vi.mocked(api.chat).mockResolvedValue(
      reply({
        proposals: [{ kind: "create_element", tempId: "new:igor", element: { name: "Igor" } }],
      }),
    );
    const { onApply } = setup();
    await screen.findByText("Was soll ich in der Welt nachtragen?");
    await askQuestion("Lege Igor an.");

    fireEvent.click(await screen.findByText("Bearbeiten"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Igor Venn" } });
    fireEvent.click(screen.getByText("Änderung speichern"));
    fireEvent.click(screen.getByText("Übernehmen"));

    expect(onApply).toHaveBeenCalledWith([
      expect.objectContaining({ element: expect.objectContaining({ name: "Igor Venn" }) }),
    ]);
  });

  it("keeps ignored proposals out of the apply operation", async () => {
    vi.mocked(api.chat).mockResolvedValue(
      reply({
        proposals: [{ kind: "create_element", tempId: "new:igor", element: { name: "Igor" } }],
      }),
    );
    const { onApply } = setup();
    await screen.findByText("Was soll ich in der Welt nachtragen?");
    await askQuestion("Lege Igor an.");
    fireEvent.click(await screen.findByText("Ignorieren"));

    expect(screen.getByText("Ignoriert")).toBeInTheDocument();
    expect(screen.getByText("Alle übernehmen").closest("button")).toBeDisabled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("applies a reviewed extraction group as one history operation", async () => {
    const proposals = [
      { kind: "create_element" as const, tempId: "new:nova", element: { name: "Nova" } },
      {
        kind: "create_element" as const,
        tempId: "new:hafen",
        element: { name: "Alter Hafen", type: "ort" as const },
      },
    ];
    vi.mocked(api.chat).mockResolvedValue(
      reply({
        mode: "world_extraction",
        proposals,
        proposalGroups: [{ id: "elements", proposalIndexes: [0, 1] }],
        proposalEnvelopes: proposals.map((proposal) => ({
          proposal,
          evidence: [],
          claimStatus: "objective_fact" as const,
        })),
      }),
    );
    const { onApply } = setup();
    await screen.findByText("Was soll ich in der Welt nachtragen?");
    fireEvent.click(
      screen.getByRole("button", { name: "Weltmodell aus Manuskript aktualisieren" }),
    );
    fireEvent.click(await screen.findByText("Gruppe übernehmen"));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0]).toHaveLength(2);
    expect(onApply).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ kind: "create_element", element: { name: "Nova" } }),
        expect.objectContaining({
          kind: "create_element",
          element: { name: "Alter Hafen", type: "ort" },
        }),
      ]),
    );
  });
});
