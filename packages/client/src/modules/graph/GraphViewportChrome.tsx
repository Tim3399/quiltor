import {
  ControlButton,
  Controls,
  type FitViewOptions,
  MiniMap,
  type MiniMapProps,
  type Node,
} from "@xyflow/react";
import { Lock, LockOpen, Map as MapIcon } from "lucide-react";
import { useI18n } from "../../i18n";
import "./GraphViewportChrome.css";

export type GraphViewportChromeProps<NodeType extends Node = Node> = {
  minimapProps?: MiniMapProps<NodeType> | false;
  minimapVisible: boolean;
  onMinimapVisibleChange: (visible: boolean) => void;
  /**
   * What the dock's fit button should frame.
   *
   * The canvas has its own copy for the fit it performs on arrival, and the
   * button is a second caller that would otherwise frame everything -- which on
   * a surface where one node is the ground means framing the ground.
   */
  fitViewOptions?: FitViewOptions<NodeType>;
  /** Whether the surface may be rearranged, which the canvas above owns. */
  interactive?: boolean;
  onInteractiveChange?: (interactive: boolean) => void;
};

/** Shared React Flow navigation dock and optional overview map. */
export function GraphViewportChrome<NodeType extends Node>({
  minimapProps = {},
  minimapVisible,
  onMinimapVisibleChange,
  fitViewOptions,
  interactive = true,
  onInteractiveChange,
}: GraphViewportChromeProps<NodeType>) {
  const { t } = useI18n();
  const supportsMinimap = minimapProps !== false;
  const toggleLabel = minimapVisible ? t("hideMinimap") : t("showMinimap");
  // The dock's own padlock stands for the arrangement alone -- whether things can
  // be moved, selected and connected -- and says so in its name. It was React
  // Flow's, with an English tooltip, and next to a menu switch that limits the
  // view to the map a padlock read as the same setting.
  const lockLabel = interactive ? t("lockArrangement") : t("unlockArrangement");

  return (
    <>
      <Controls
        position="bottom-left"
        aria-label={t("graphControlsLabel")}
        fitViewOptions={fitViewOptions}
        showInteractive={false}
      >
        {onInteractiveChange && (
          <ControlButton
            className="graph-arrangement-lock"
            aria-label={lockLabel}
            aria-pressed={!interactive}
            title={lockLabel}
            onClick={() => onInteractiveChange(!interactive)}
          >
            {interactive ? <LockOpen aria-hidden="true" /> : <Lock aria-hidden="true" />}
          </ControlButton>
        )}
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
