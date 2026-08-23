import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { quiltorClient } from "../../platform";
import { I18nProvider } from "../../i18n";
import type { Chapter } from "../manuscript";
import type { FigureState } from "../story-world";
import { AssistantDrawer } from "./AssistantDrawer";
import type { AssistantJobState, AssistantReply } from "./model";

export const api = quiltorClient.application.assistant;
export const preferences = quiltorClient.platform.preferences;
vi.spyOn(api, "status");
vi.spyOn(api, "chat");
vi.spyOn(api, "wait");
vi.spyOn(api, "cancelJob");
vi.spyOn(api, "progress");
vi.spyOn(api, "install");
vi.spyOn(api, "installStatus");

Element.prototype.scrollIntoView = vi.fn();

afterEach(cleanup);

export const FIGURES: FigureState = {
  nodes: [{ id: "tarek", x: 0, y: 0, name: "Tarek Venn", type: "person" }],
  edges: [],
};

export const CHAPTERS: Chapter[] = [
  { id: "c1", title: "Die Krönung", body: "", note: "" },
  { id: "c2", title: "Am Fluss", body: "", note: "" },
];

export const ONLINE = {
  ok: true,
  available: true,
  mode: "local",
  reason: "",
  installed: true,
  chunks: 3,
};

export const OFFLINE = {
  ok: true,
  available: false,
  mode: "local",
  reason: "Lokaler Modell-Prozess ist beendet.",
  installed: true,
  chunks: 0,
};

export const NOT_INSTALLED = {
  ok: true,
  available: false,
  mode: "local",
  reason: "Lokales Modell ist noch nicht installiert oder gestartet.",
  installed: false,
  chunks: 0,
};

export function reply(patch: Partial<AssistantReply> = {}): AssistantReply {
  return { ok: true, message: "Alles bereit.", proposals: [], sources: [], ...patch };
}

export function job(patch: Partial<AssistantJobState> = {}): AssistantJobState {
  return {
    id: "job-1",
    status: "running",
    error: "",
    errorType: "",
    cancelRequested: false,
    createdAt: "2026-08-19T06:00:00+00:00",
    ...patch,
  };
}

export function setup(worldId = "world-1", chapters: Chapter[] = CHAPTERS, open = true) {
  const onApply = vi.fn();
  const onNavigate = vi.fn();
  const onClose = vi.fn();
  const { unmount, rerender } = render(
    <I18nProvider>
      <AssistantDrawer
        worldId={worldId}
        figures={FIGURES}
        chapters={chapters}
        currentChapterId={chapters[0]?.id || ""}
        open={open}
        onApply={onApply}
        onNavigate={onNavigate}
        onClose={onClose}
      />
    </I18nProvider>,
  );
  const setOpen = (value: boolean) =>
    rerender(
      <I18nProvider>
        <AssistantDrawer
          worldId={worldId}
          figures={FIGURES}
          chapters={chapters}
          currentChapterId={chapters[0]?.id || ""}
          open={value}
          onApply={onApply}
          onNavigate={onNavigate}
          onClose={onClose}
        />
      </I18nProvider>,
    );
  return { onApply, onNavigate, onClose, unmount, setOpen };
}

export async function askQuestion(question: string) {
  fireEvent.change(
    screen.getByPlaceholderText("Figur anlegen, Beziehung ändern, Timeline prüfen …"),
    { target: { value: question } },
  );
  fireEvent.click(screen.getByLabelText("Nachricht senden"));
}

beforeEach(() => {
  for (const worldId of [
    "world-1",
    "world-a",
    "world-b",
    "world-batch",
    "world-cancel",
    "world-clear",
    "world-durable-request",
    "world-empty",
    "world-resume",
  ])
    preferences.remove(`quiltor-assistant:${worldId}`);
  vi.mocked(api.status).mockReset().mockResolvedValue(ONLINE);
  vi.mocked(api.chat).mockReset();
  vi.mocked(api.wait).mockReset();
  vi.mocked(api.cancelJob)
    .mockReset()
    .mockResolvedValue(job({ status: "cancelled", cancelRequested: true }));
  vi.mocked(api.progress).mockReset().mockResolvedValue({ ok: false, progress: null });
  vi.mocked(api.install).mockReset().mockResolvedValue({ ok: true, started: true });
  vi.mocked(api.installStatus)
    .mockReset()
    .mockResolvedValue({ ok: true, running: false, phase: "", percent: 0, error: "" });
});
