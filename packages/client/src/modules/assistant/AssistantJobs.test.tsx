import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api, askQuestion, job, preferences, reply, setup } from "./AssistantDrawer.testSupport";
import type { AssistantReply } from "./model";

describe("assistant job lifecycle", () => {
  it("shows sending state until the reply arrives", async () => {
    let resolveChat!: (value: AssistantReply) => void;
    vi.mocked(api.chat).mockReturnValue(
      new Promise((resolve) => {
        resolveChat = resolve;
      }),
    );
    setup();
    await screen.findByText("Was soll ich in der Welt nachtragen?");
    await askQuestion("Wer ist Tarek?");
    expect(
      screen.getByPlaceholderText("Figur anlegen, Beziehung ändern, Timeline prüfen …"),
    ).toBeDisabled();
    expect(screen.getByText(/durchsuche deine Welt/)).toBeInTheDocument();
    await act(async () => resolveChat(reply({ message: "Tarek ist ein Ritter." })));
    expect(await screen.findByText("Tarek ist ein Ritter.")).toBeInTheDocument();
    expect(screen.queryByText(/durchsuche deine Welt/)).not.toBeInTheDocument();
  });

  it("persists the logical request id before the server acknowledges a job", async () => {
    let resolveChat!: (value: AssistantReply) => void;
    vi.mocked(api.chat).mockReturnValue(
      new Promise((resolve) => {
        resolveChat = resolve;
      }),
    );
    setup("world-durable-request");
    await screen.findByText("Was soll ich in der Welt nachtragen?");
    await askQuestion("Wer ist Tarek?");

    const saved = JSON.parse(preferences.get("quiltor-assistant:world-durable-request") || "[]");
    expect(saved[0].question).toBe("Wer ist Tarek?");
    expect(saved[0].requestId).toEqual(expect.any(String));
    await act(async () => resolveChat(reply()));
  });

  it("synchronously blocks duplicate submits before React state commits", async () => {
    let resolveChat!: (value: AssistantReply) => void;
    vi.mocked(api.chat).mockReturnValue(
      new Promise((resolve) => {
        resolveChat = resolve;
      }),
    );
    const { onBeforeSend } = setup();
    await screen.findByText("Was soll ich in der Welt nachtragen?");
    const input = screen.getByPlaceholderText("Figur anlegen, Beziehung ändern, Timeline prüfen …");
    fireEvent.change(input, { target: { value: "Wer ist Tarek?" } });

    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    expect(onBeforeSend).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.chat).toHaveBeenCalledTimes(1));
    await act(async () => resolveChat(reply()));
  });

  it("keeps an in-flight reply while the mounted drawer is closed", async () => {
    let resolveChat!: (value: AssistantReply) => void;
    vi.mocked(api.chat).mockReturnValue(
      new Promise((resolve) => {
        resolveChat = resolve;
      }),
    );
    const { setOpen } = setup();
    await screen.findByText("Was soll ich in der Welt nachtragen?");
    await askQuestion("Wer ist Tarek?");
    expect(screen.getByText(/durchsuche deine Welt/)).toBeInTheDocument();

    setOpen(false);
    expect(screen.queryByText(/durchsuche deine Welt/)).not.toBeInTheDocument();
    await act(async () => resolveChat(reply({ message: "Tarek ist ein Ritter." })));

    setOpen(true);
    expect(await screen.findByText("Tarek ist ein Ritter.")).toBeInTheDocument();
    expect(api.chat).toHaveBeenCalledTimes(1);
  });

  it("resumes a persisted server job after reload without resending", async () => {
    preferences.set(
      "quiltor-assistant:world-resume",
      JSON.stringify([
        {
          id: "entry-1",
          question: "Wer ist Tarek?",
          applied: [],
          requestId: "request-1",
          jobId: "job-1",
        },
      ]),
    );
    vi.mocked(api.wait).mockResolvedValue(reply({ message: "Tarek ist ein Ritter." }));

    setup("world-resume");

    expect(await screen.findByText("Tarek ist ein Ritter.")).toBeInTheDocument();
    expect(api.wait).toHaveBeenCalledWith("job-1", expect.any(AbortSignal));
    expect(api.chat).not.toHaveBeenCalled();
  });

  it("retries the same question after an error", async () => {
    vi.mocked(api.chat)
      .mockRejectedValueOnce(new Error("Das lokale Modell ist nicht erreichbar."))
      .mockResolvedValueOnce(reply({ message: "Jetzt hat es geklappt." }));
    setup();
    await screen.findByText("Was soll ich in der Welt nachtragen?");
    await askQuestion("Wer ist Tarek?");
    expect(await screen.findByText("Das lokale Modell ist nicht erreichbar.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Erneut versuchen"));
    expect(await screen.findByText("Jetzt hat es geklappt.")).toBeInTheDocument();
    expect(api.chat).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.chat).mock.calls[1][0]).toBe("Wer ist Tarek?");
    expect(screen.getAllByText("Wer ist Tarek?")).toHaveLength(1);
  });

  it("reuses the idempotency key after an ambiguous creation failure", async () => {
    vi.mocked(api.chat)
      .mockRejectedValueOnce(new TypeError("network disconnected"))
      .mockResolvedValueOnce(reply({ message: "Wieder verbunden." }));
    setup();
    await screen.findByText("Was soll ich in der Welt nachtragen?");
    await askQuestion("Wer ist Tarek?");
    await screen.findByText("network disconnected");

    const firstKey = vi.mocked(api.chat).mock.calls[0][5];
    fireEvent.click(screen.getByText("Erneut versuchen"));
    await screen.findByText("Wieder verbunden.");

    expect(vi.mocked(api.chat).mock.calls[1][5]).toBe(firstKey);
  });

  it("aborts local polling and cancels an acknowledged server job", async () => {
    vi.mocked(api.chat).mockImplementation(
      (_question, _history, signal, _chapterIds, _batch, _key, onJobCreated) => {
        onJobCreated?.(job({ id: "job-cancel" }));
        return new Promise((_, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        });
      },
    );
    setup();
    await screen.findByText("Was soll ich in der Welt nachtragen?");
    await askQuestion("Wer ist Tarek?");
    fireEvent.click(screen.getByLabelText("Anfrage abbrechen"));

    expect(await screen.findByText("Anfrage abgebrochen.")).toBeInTheDocument();
    expect(api.cancelJob).toHaveBeenCalledWith("job-cancel");
  });

  it("announces batch progress while a chapter-group job is running", async () => {
    let resolveBatch!: (value: AssistantReply) => void;
    vi.mocked(api.progress).mockResolvedValue({
      ok: true,
      progress: { total: 2, done: 1, startedAt: 1, updatedAt: 2 },
    });
    vi.mocked(api.chat)
      .mockResolvedValueOnce(
        reply({
          broadScope: { chapterCount: 2, estimateSeconds: 10 },
        }),
      )
      .mockImplementationOnce(
        (_question, _history, _signal, _chapterIds, _batch, _key, onJobCreated) => {
          onJobCreated?.(job({ id: "job-batch", progressId: "progress-1" }));
          return new Promise((resolve) => {
            resolveBatch = resolve;
          });
        },
      );

    setup("world-batch");
    await screen.findByText("Was soll ich in der Welt nachtragen?");
    await askQuestion("Prüfe alle Kapitel.");
    fireEvent.click(await screen.findByText("In Kapitel-Gruppen ausführen"));

    const progress = await screen.findByRole("progressbar", {
      name: "Kapitel-Gruppen werden verarbeitet … (1/2)",
    });
    expect(progress).toHaveAttribute("aria-valuenow", "1");
    expect(progress).toHaveAttribute("aria-valuemax", "2");
    await act(async () => resolveBatch(reply()));
  });
});
