import { cleanup, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api, askQuestion, preferences, reply, setup } from "./AssistantDrawer.testSupport";

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
    fireEvent.click(screen.getByText("1. Die Krönung"));
    expect(screen.getByText("Kontext: Kapitelauswahl (1)")).toBeInTheDocument();
    await askQuestion("Fasse das zusammen.");
    expect(vi.mocked(api.chat).mock.calls[0][3]).toEqual(["c1"]);
  });

  it("omits the chapter picker when there are no manuscript chapters", async () => {
    setup("world-empty", []);
    await screen.findByText("Was soll ich in der Welt nachtragen?");
    expect(screen.queryByText("Kontext: gesamte Welt")).not.toBeInTheDocument();
  });
});
