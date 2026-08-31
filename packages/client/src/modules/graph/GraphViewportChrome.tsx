import { ControlButton, Controls, MiniMap, type MiniMapProps, type Node } from "@xyflow/react";
import { Map as MapIcon } from "lucide-react";
import { useI18n } from "../../i18n";
import "./GraphViewportChrome.css";

export type GraphViewportChromeProps<NodeType extends Node = Node> = {
  minimapProps?: MiniMapProps<NodeType> | false;
  minimapVisible: boolean;
  onMinimapVisibleChange: (visible: boolean) => void;
};

/** Shared React Flow navigation dock and optional overview map. */
export function GraphViewportChrome<NodeType extends Node>({
  minimapProps = {},
  minimapVisible,
  onMinimapVisibleChange,
}: GraphViewportChromeProps<NodeType>) {
  const { t } = useI18n();
  const supportsMinimap = minimapProps !== false;
  const toggleLabel = minimapVisible ? t("hideMinimap") : t("showMinimap");

  return (
    <>
      <Controls position="bottom-left" aria-label={t("graphControlsLabel")}>
        {supportsMinimap && (
          <ControlButton
            className="graph-minimap-toggle"
            aria-label={toggleLabel}
            aria-pressed={minimapVisible}
            title={toggleLabel}
            onClick={() => onMinimapVisibleChange(!minimapVisible)}
          >
            <MapIcon aria-hidden="true" />
          </ControlButton>
        )}
      </Controls>
      {supportsMinimap && minimapVisible && (
        <MiniMap<NodeType>
          pannable
          zoomable
          maskColor="var(--minimap-mask)"
          {...minimapProps}
          position="bottom-right"
          ariaLabel={t("minimapLabel")}
        />
      )}
    </>
  );
}
