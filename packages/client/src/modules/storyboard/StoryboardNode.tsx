import { Handle, type NodeProps, NodeResizer, Position } from "@xyflow/react";
import { ExternalLink, Frame, LayoutDashboard, Scaling, StickyNote } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button, IconButton, ScrollArea, TextField } from "../../design";
import { useI18n } from "../../i18n";
import { cardKindClassName, GRAPH_CONNECTION_HANDLES } from "../graph";
import { NoteEditor } from "../notes";
import type { StoryboardBoardNode, StoryboardReferenceNode } from "./model";
import {
  STORYBOARD_NODE_SIZES,
  type StoryboardFlowNode,
  type StoryboardFlowNodeData,
} from "./storyboardCanvasModel";
import "./StoryboardNode.css";

export const storyboardNodeTypes = { storyboard: StoryboardCanvasNode };

/**
 * The card's own scroller, and only then.
 *
 * `nowheel` hands the wheel to this body instead of the canvas -- necessary while there is
 * something to scroll here, wrong the rest of the time: a board full of short cards would
 * swallow every zoom, because the pointer is almost always over one of them. So the class
 * is worn only while the content actually overflows.
 */
function StoryboardNodeBody({ children }: { children: ReactNode }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);

  const measure = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    const overflows = (element: HTMLElement) => element.scrollHeight - element.clientHeight > 1;
    // A note brings its own scroller along, inside CodeMirror. The body then reports no
    // overflow at all while forty lines sit inside it -- the card wore no `nowheel`, and
    // the wheel zoomed the canvas instead of scrolling the note.
    //
    // The class goes on that scroller, not on the body around it. The body reaches further
    // than its content: a note's format bar hangs out over the card's edge, and there is
    // nothing to scroll above it -- a `nowheel` on the body would have swallowed the
    // canvas zoom there.
    for (const element of body.querySelectorAll<HTMLElement>(".nowheel")) {
      element.classList.remove("nowheel");
    }
    for (const element of body.querySelectorAll<HTMLElement>("*")) {
      if (!overflows(element)) continue;
      const overflowY = getComputedStyle(element).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") element.classList.add("nowheel");
    }
    setScrollable(overflows(body));
  }, []);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    measure();
    const observers: { disconnect: () => void }[] = [];
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(measure);
      observer.observe(body);
      for (const child of body.children) observer.observe(child);
      observers.push(observer);
    }
    // A foreign scroller grows without any size changing: typed lines only raise its
    // scrollHeight. A ResizeObserver does not see that.
    if (typeof MutationObserver === "function") {
      const observer = new MutationObserver(measure);
      observer.observe(body, { subtree: true, childList: true, characterData: true });
      observers.push(observer);
    }
    return () => {
      for (const observer of observers) observer.disconnect();
    };
  }, [measure]);

  return (
    <ScrollArea
      ref={bodyRef}
      className={`storyboard-node__body${scrollable ? " nowheel" : ""}`}
      axis="y"
      gutter="auto"
      overscroll="contain"
      scrollbar="thin"
      surface="transparent"
    >
      {children}
    </ScrollArea>
  );
}

function ConnectionHandles({
  directedLabel,
  undirectedLabel,
}: {
  directedLabel: string;
  undirectedLabel: string;
}) {
  return (
    <>
      <Handle
        id={GRAPH_CONNECTION_HANDLES.incoming}
        className="directed-handle incoming-handle"
        type="target"
        position={Position.Left}
        title={directedLabel}
      />
      <Handle
        id={GRAPH_CONNECTION_HANDLES.neutralTop}
        className="neutral-handle"
        type="source"
        position={Position.Top}
        title={undirectedLabel}
      />
      <Handle
        id={GRAPH_CONNECTION_HANDLES.outgoing}
        className="directed-handle outgoing-handle"
        type="source"
        position={Position.Right}
        title={directedLabel}
      />
      <Handle
        id={GRAPH_CONNECTION_HANDLES.neutralBottom}
        className="neutral-handle"
        type="source"
        position={Position.Bottom}
        title={undirectedLabel}
      />
    </>
  );
}

function StoryboardConnectionHandles() {
  const { t } = useI18n();
  return (
    <ConnectionHandles
      directedLabel={t("storyboardConnectDirectedHint")}
      undirectedLabel={t("storyboardConnectUndirectedHint")}
    />
  );
}

function ResizeControls({ data, selected }: { data: StoryboardFlowNodeData; selected: boolean }) {
  const { t } = useI18n();
  const { item } = data;
  const fallback = STORYBOARD_NODE_SIZES[item.kind];
  const renderedHeight =
    item.kind === "reference" || item.kind === "storyboard"
      ? Math.max(item.height ?? fallback.height, fallback.height)
      : (item.height ?? fallback.height);
  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={item.kind === "group" ? STORYBOARD_NODE_SIZES.reference.width : 200}
        minHeight={
          item.kind === "group"
            ? 180
            : item.kind === "reference" || item.kind === "storyboard"
              ? fallback.height
              : 120
        }
        handleClassName="storyboard-node__resize-handle"
        lineClassName="storyboard-node__resize-line"
        onResizeEnd={(_, size) =>
          data.onPatch(item.id, {
            x: size.x,
            y: size.y,
            width: size.width,
            height: size.height,
          })
        }
      />
      {selected && (
        <IconButton
          className="storyboard-node__resize-action nodrag nopan"
          label={t("storyboardResizeNode")}
          icon={<Scaling />}
          onClick={() =>
            data.onPatch(item.id, {
              width: (item.width ?? fallback.width) + 40,
              height: renderedHeight + 30,
            })
          }
        />
      )}
    </>
  );
}

function StoryboardNodeNoteEditor({ data }: { data: StoryboardFlowNodeData }) {
  const { t } = useI18n();
  const { item } = data;
  const isNoteCard = item.kind === "note";
  const name =
    item.kind === "storyboard"
      ? (data.boardTitle ?? item.label ?? t("storyboardBoardKind"))
      : (item.label ??
        (item.kind === "reference"
          ? t("storyboardReferenceKind")
          : item.kind === "group"
            ? t("storyboardGroupKind")
            : t("storyboardNoteKind")));
  const editorLabel = isNoteCard
    ? t("storyboardNoteEditorLabel")
    : t("storyboardNodeNoteEditorLabel", { name });
  const context = data.boardContext ?? data.boardTitle ?? t("storyboardTitle");

  return (
    <div
      className={`storyboard-node__note ${isNoteCard ? "" : "storyboard-node__note--compact"}`.trim()}
    >
      <NoteEditor
        owner={{ kind: "storyboard", id: item.id }}
        label={editorLabel}
        value={item.text ?? ""}
        references={item.noteReferences ?? []}
        marks={item.noteMarks ?? []}
        placeholder={
          isNoteCard ? t("storyboardNotePlaceholder") : t("storyboardNodeNotePlaceholder")
        }
        size="compact"
        // On a reference or storyboard card the note is still a note, not a single line:
        // the card is 210px tall and resizable, so the text fills what is there. A fixed
        // row count left the rest of the card empty and forced scrolling inside the field
        // while space sat next to it.
        fill
        labelHidden
        fieldClassName="storyboard-node-note-field nodrag nopan"
        formatActionClassName="storyboard-note-format nodrag nopan"
        className="storyboard-note-control nodrag nopan"
        focus={{
          openLabel: t("storyboardNoteFocusOpen"),
          title: isNoteCard
            ? t("storyboardNoteFocusTitle", { context })
            : t("storyboardNodeNoteFocusTitle", { name, context }),
          closeLabel: t("storyboardNoteFocusClose"),
          editorLabel,
        }}
        focusButtonClassName="nodrag nopan"
        onChange={(text, references, marks) => data.onNoteChange(item.id, text, references, marks)}
      />
    </div>
  );
}

function StoryboardCanvasNode({ data, selected }: NodeProps<StoryboardFlowNode>) {
  const { t } = useI18n();
  const { item } = data;
  const className = [
    "storyboard-node",
    `storyboard-node--${item.kind}`,
    ...cardKindClassName(data.cardKind).split(" "),
    selected ? "is-selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (item.kind === "note") {
    return (
      <article className={className} data-storyboard-node-kind="note">
        <ResizeControls data={data} selected={selected} />
        <StoryboardConnectionHandles />
        <header className="storyboard-node__header">
          <span className="storyboard-node__kind">
            <StickyNote aria-hidden="true" />
            {t("storyboardNoteKind")}
          </span>
        </header>
        <StoryboardNodeBody>
          <StoryboardNodeNoteEditor data={data} />
        </StoryboardNodeBody>
      </article>
    );
  }

  if (item.kind === "reference") {
    return (
      <article className={className} data-storyboard-node-kind="reference">
        <ResizeControls data={data} selected={selected} />
        <StoryboardConnectionHandles />
        <header className="storyboard-node__header">
          <span className="storyboard-node__kind">
            <ExternalLink aria-hidden="true" />
            {t("storyboardReferenceKind")}
          </span>
        </header>
        <StoryboardNodeBody>
          <strong className="storyboard-node__title">{item.label}</strong>
          <StoryboardNodeNoteEditor data={data} />
          <Button
            className="storyboard-node__open nodrag nopan"
            size="compact"
            appearance="ghost"
            icon={<ExternalLink />}
            onClick={() => data.onOpenReference(item as StoryboardReferenceNode)}
          >
            {t("storyboardOpenReference")}
          </Button>
        </StoryboardNodeBody>
      </article>
    );
  }

  if (item.kind === "storyboard") {
    return (
      <article className={className} data-storyboard-node-kind="storyboard">
        <ResizeControls data={data} selected={selected} />
        <StoryboardConnectionHandles />
        <header className="storyboard-node__header">
          <span className="storyboard-node__kind">
            <LayoutDashboard aria-hidden="true" />
            {t("storyboardBoardKind")}
          </span>
        </header>
        <StoryboardNodeBody>
          <strong className="storyboard-node__title">{data.boardTitle ?? item.label}</strong>
          <StoryboardNodeNoteEditor data={data} />
          <Button
            className="storyboard-node__open nodrag nopan"
            size="compact"
            appearance="ghost"
            icon={<LayoutDashboard />}
            onClick={() => data.onOpenBoard(item as StoryboardBoardNode)}
          >
            {t("storyboardOpenBoard")}
          </Button>
        </StoryboardNodeBody>
      </article>
    );
  }

  return (
    <article className={className} data-storyboard-node-kind="group">
      <ResizeControls data={data} selected={selected} />
      <StoryboardConnectionHandles />
      <header className="storyboard-node__header">
        <span className="storyboard-node__kind">
          <Frame aria-hidden="true" />
          {t("storyboardGroupKind")}
        </span>
      </header>
      <StoryboardNodeBody>
        <TextField
          fieldClassName="storyboard-group-title-field nodrag nopan"
          className="storyboard-group-title-control nodrag nopan"
          label={t("storyboardGroupTitle")}
          labelHidden
          value={item.label ?? ""}
          onChange={(event) => data.onPatch(item.id, { label: event.target.value })}
        />
        <StoryboardNodeNoteEditor data={data} />
      </StoryboardNodeBody>
    </article>
  );
}
