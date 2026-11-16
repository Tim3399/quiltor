import { fireEvent, render, screen } from "@testing-library/react";
import { type ButtonHTMLAttributes, type ReactNode, Suspense } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { loadFigureWorkspace } from "../../modules/story-world";
import { createDefaultStoryboardState } from "../../modules/storyboard";
import { WorkspaceSurface } from "./WorkspaceSurface";

// Only the canvas library is replaced: the surface, the lazy figure workspace and its
// timeline strip are the real ones, which is what the wiring under test runs through.
vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xyflow/react")>()),
  ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
  ReactFlow: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Background: () => null,
  Controls: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ControlButton: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Handle: () => null,
  MiniMap: () => <div />,
  Panel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ConnectionLineType: { SmoothStep: "smoothstep" },
  ConnectionMode: { Loose: "loose" },
  BackgroundVariant: { Lines: "lines" },
  Position: { Bottom: "bottom", Left: "left", Right: "right", Top: "top" },
  applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
  useUpdateNodeInternals: () => vi.fn(),
}));

const manuscript = {
  chapters: [
    {
      id: "hafen",
      title: "Am Hafen",
      body: "Der Morgen lag still über dem Hafen.",
      note: "",
      storyTime: { startMomentId: "ankunft" },
    },
  ],
};
const figures = {
  nodes: [],
  edges: [],
  timeline: [
    { id: "ankunft", title: "Ankunft" },
    { id: "abreise", title: "Abreise" },
  ],
};
// Load the lazy workspace up front so its cold module transform is not timed by the test.
beforeAll(async () => {
  await loadFigureWorkspace();
});

const actions = { change: vi.fn(), undo: vi.fn(), redo: vi.fn(), canUndo: false, canRedo: false };

function Surface() {
  return (
    <I18nProvider>
      <Suspense fallback={<div>Wird geladen</div>}>
        <WorkspaceSurface
          worldId="world-a"
          worldTitle="Testwelt"
          workspace="figures"
          manuscript={manuscript}
          figures={figures}
          storyboards={createDefaultStoryboardState()}
          orphanedMentions={0}
          manuscriptHistory={actions}
          figureHistory={actions}
          storyboardHistory={actions}
          referenceCandidates={[]}
          onFiguresChange={vi.fn()}
          target={null}
          onNavigate={vi.fn()}
          focus={false}
          onFocus={vi.fn()}
          onSave={async () => {}}
          currentChapterId="hafen"
          onCurrentChapterId={vi.fn()}
        />
      </Suspense>
    </I18nProvider>
  );
}

describe("WorkspaceSurface figure board", () => {
  it("hands the manuscript to the figure board so a moment a chapter uses cannot be deleted", async () => {
    render(<Surface />);

    fireEvent.click(await screen.findByRole("button", { name: /Ankunft/ }));
    expect(screen.getByRole("button", { name: "Zeitpunkt löschen" })).toBeDisabled();
    expect(screen.getByText(/von Kapitel „Am Hafen“ verwendet/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Abreise/ }));
    expect(screen.getByRole("button", { name: "Zeitpunkt löschen" })).toBeEnabled();
  });
});
