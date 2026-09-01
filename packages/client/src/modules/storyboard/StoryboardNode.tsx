import { Handle, type NodeProps, NodeResizer, Position } from "@xyflow/react";
import { ExternalLink, Frame, LayoutDashboard, Scaling, StickyNote } from "lucide-react";
import type { ReactNode } from "react";
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

function StoryboardNodeBody({ children }: { children: ReactNode }) {
  return (
    <ScrollArea
      className="storyboard-node__body nowheel"
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
        fill={isNoteCard}
        rows={isNoteCard ? undefined : 1}
        labelHidden
        fieldClassName="storyboard-node-note-field nodrag nopan"
        formatActionClassName="nodrag nopan"
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
