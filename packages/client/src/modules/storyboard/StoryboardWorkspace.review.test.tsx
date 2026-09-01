import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ButtonHTMLAttributes, ComponentType, ReactNode } from "react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { createDefaultStoryboardState, type StoryboardState } from "./model";
import { StoryboardWorkspace } from "./StoryboardWorkspace";

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
  Background: () => null,
  BackgroundVariant: { Lines: "lines" },
  ConnectionLineType: { SmoothStep: "smoothstep" },
  ConnectionMode: { Loose: "loose" },
  Controls: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ControlButton: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Handle: ({ title }: { title?: string }) => <span aria-hidden="true" title={title} />,
  MiniMap: () => null,
  NodeResizer: ({ isVisible }: { isVisible?: boolean }) =>
    isVisible ? <span data-testid="workspace-pointer-resizer" aria-hidden="true" /> : null,
  Panel: ({ children }: { children: ReactNode }) => children,
  Position: { Bottom: "bottom", Left: "left", Right: "right", Top: "top" },
  ReactFlow: ({
    children,
    nodeTypes,
    nodes,
    ...props
  }: {
    children?: ReactNode;
    nodeTypes?: Record<string, ComponentType<Record<string, unknown>>>;
    nodes: Array<{
      id: string;
      type?: string;
      data: Record<string, unknown>;
      selected?: boolean;
    }>;
    "aria-label"?: string;
  }) => (
    <div role="application" aria-label={props["aria-label"]} data-testid="storyboard-flow">
      {nodes.map((node) => {
        const Node = nodeTypes?.[node.type ?? ""];
        return Node ? (
          <Node key={node.id} id={node.id} data={node.data} selected={node.selected ?? false} />
        ) : null;
      })}
      {children}
    </div>
  ),
  ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
}));

afterEach(cleanup);

function ControlledStoryboard({ onChange }: { onChange: (state: StoryboardState) => void }) {
  const [state, setState] = useState(createDefaultStoryboardState());
  return (
    <I18nProvider>
      <StoryboardWorkspace
        state={state}
        candidates={[]}
        onOpenReference={vi.fn()}
        onChange={(next) => {
          onChange(next);
          setState(next);
        }}
      />
    </I18nProvider>
  );
}

function editorView(textbox: HTMLElement) {
  const root = textbox.closest<HTMLElement>(".cm-editor");
  if (!root) throw new Error("CodeMirror root missing");
  const view = EditorView.findFromDOM(root);
  if (!view) throw new Error("CodeMirror view missing");
  return view;
}

describe("Storyboard workspace review guards", () => {
  it("creates a visually lean, directly editable Note card", () => {
    const onChange = vi.fn();
    render(<ControlledStoryboard onChange={onChange} />);

    const workspace = screen.getByRole("region", { name: "Storyboard" });
    expect(workspace).not.toHaveTextContent(/Freie Planung|nicht Teil des Kanons/i);
    expect(screen.getByLabelText("Platz für deine Ideen")).toBeInTheDocument();
    const toolbar = screen.getByRole("toolbar", { name: "Storyboard-Werkzeuge" });
    fireEvent.click(within(toolbar).getByRole("button", { name: "Notiz hinzufügen" }));

    expect(screen.queryByLabelText("Platz für deine Ideen")).not.toBeInTheDocument();
    const noteCard = document.querySelector('[data-storyboard-node-kind="note"]');
    expect(noteCard).toBeInTheDocument();
    expect(noteCard?.closest(".nowheel")).toBeNull();
    expect(noteCard?.querySelector(".nowheel")).toBeNull();
    expect(noteCard).not.toHaveTextContent(/Freie Planung|nicht Teil des Kanons/i);
    const textbox = screen.getByRole("textbox", { name: "Storyboard-Notiz" });
    expect(document.querySelector(`label[for="${textbox.id}"]`)).toHaveClass("sr-only");
    const note = textbox.closest(".storyboard-node__note");
    expect(note).not.toHaveClass("nodrag");
    expect(note).not.toHaveClass("nopan");
    expect(textbox.closest(".nodrag")).toBeNull();
    expect(screen.getByRole("button", { name: "Notiz im Fokus öffnen" })).toHaveClass(
      "nodrag",
      "nopan",
    );

    act(() => {
      const view = editorView(textbox);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "Vielleicht endet es anders" },
        selection: { anchor: "Vielleicht endet es anders".length },
        userEvent: "input",
      });
    });

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        nodes: [
          expect.objectContaining({
            kind: "note",
            text: "Vielleicht endet es anders",
            boardId: "main-storyboard",
          }),
        ],
      }),
    );
  });

  it("keeps board context and canvas actions in deterministic responsive toolbar rows", () => {
    render(<ControlledStoryboard onChange={vi.fn()} />);

    const toolbar = screen.getByRole("toolbar", { name: "Storyboard-Werkzeuge" });
    expect(toolbar).toHaveClass("storyboard-toolbar");
    expect(toolbar.querySelector(".storyboard-toolbar__title")).toBeInTheDocument();
    expect(toolbar.querySelector(".storyboard-toolbar__board-actions")).toContainElement(
      screen.getByRole("combobox", { name: "Storyboard auswählen" }),
    );
    const toolActions = toolbar.querySelector<HTMLElement>(".storyboard-toolbar__tool-actions");
    expect(toolActions).toBeInTheDocument();
    expect(
      within(toolActions as HTMLElement).getByRole("button", { name: "Notiz hinzufügen" }),
    ).toBeInTheDocument();

    const css = readFileSync(
      join(process.cwd(), "packages/client/src/modules/storyboard/StoryboardToolbar.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.storyboard-toolbar\s*\{[^}]*display:\s*grid;[^}]*grid-template-areas:[^}]*"title boards"[^}]*"tools tools";/s,
    );
    expect(css).toMatch(/\.storyboard-board-name-field\s*\{[^}]*margin:\s*0;/s);
    expect(css).toMatch(
      /@media \(max-width: 719px\)[\s\S]*?\.storyboard-toolbar__board-group\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) repeat\(2, var\(--control-touch\)\);/s,
    );
    expect(css).not.toMatch(
      /@media[^{]*pointer:\s*coarse[^{]*\{[\s\S]*storyboard-toolbar__board-group/,
    );
  });

  it("keeps compact/coarse-pointer controls touch-sized and uses design-system controls", () => {
    const root = join(process.cwd(), "packages/client/src/modules/storyboard");
    const nodeCss = readFileSync(join(root, "StoryboardNode.css"), "utf8");
    const workspaceCss = readFileSync(join(root, "StoryboardWorkspace.css"), "utf8");
    expect(nodeCss).toMatch(
      /@media \(max-width: 719px\), \(pointer: coarse\)[\s\S]*?\.storyboard-node__resize-handle\s*\{[^}]*width:\s*var\(--control-touch\);[^}]*height:\s*var\(--control-touch\);/s,
    );
    expect(workspaceCss).toMatch(
      /@media \(max-width: 820px\)[\s\S]*?\.storyboard-layout\.has-library\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s,
    );
    expect(nodeCss).toMatch(
      /\.storyboard-node__body\s*\{[^}]*min-height:\s*0;[^}]*display:\s*flex;[^}]*flex:\s*1;[^}]*touch-action:\s*none;/s,
    );
    expect(nodeCss).toMatch(
      /\.storyboard-note-control\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*100%;[^}]*resize:\s*vertical;/s,
    );

    for (const file of [
      "StoryboardToolbar.tsx",
      "StoryboardWorkspace.tsx",
      "StoryboardNode.tsx",
      "StoryboardSearchPanel.tsx",
    ]) {
      const source = readFileSync(join(root, file), "utf8");
      expect(source, file).not.toMatch(/<(?:button|input|select|textarea)\b/);
    }
  });
});
