import { Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Button,
  ConfirmDialog,
  SidePanelBody,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from "../../../design";
import { useI18n } from "../../../i18n";
import type { FigureEdge, FigureNode, FigureState } from "../model";
import { storyShortcutLabel } from "../shortcutLabels";
import { FigureCardPanel } from "./FigureCardPanel";
import { FigureProfilePanel } from "./FigureProfilePanel";
import { FigureRelationshipsPanel } from "./FigureRelationshipsPanel";
import { kindLabel } from "./relationships";
import "./FigureInspector.css";

export type FigureInspectorProps = {
  figure: FigureNode;
  state: FigureState;
  activeMomentId: string | null;
  onPatch: (patch: Partial<FigureNode>) => void;
  onState: (state: FigureState) => void;
  onDelete: () => void;
  onSelectMoment: (id: string | null) => void;
};

type InspectorTab = "card" | "profile" | "links";

export function FigureInspector({
  figure,
  state,
  activeMomentId,
  onPatch,
  onState,
  onDelete,
  onSelectMoment,
}: FigureInspectorProps) {
  const { locale, t } = useI18n();
  const [tab, setTab] = useState<InspectorTab>("card");
  const [deleteEdge, setDeleteEdge] = useState<{ edge: FigureEdge; name: string } | null>(null);

  return (
    <>
      <Tabs
        className="figure-inspector-tabs"
        value={tab}
        onValueChange={(value) => setTab(value as InspectorTab)}
      >
        <TabList label={t("inspector")}>
          <Tab value="card">{t("card")}</Tab>
          <Tab value="profile">{t("profile")}</Tab>
          <Tab value="links">{t("relationships")}</Tab>
        </TabList>
        <SidePanelBody className="figure-inspector-body">
          <TabPanel className="figure-inspector-tab-panel" value="card">
            <FigureCardPanel
              figure={figure}
              state={state}
              activeMomentId={activeMomentId}
              onPatch={onPatch}
              onState={onState}
              onSelectMoment={onSelectMoment}
            />
          </TabPanel>
          <TabPanel className="figure-inspector-tab-panel" value="profile">
            <FigureProfilePanel figure={figure} onPatch={onPatch} />
          </TabPanel>
          <TabPanel className="figure-inspector-tab-panel" value="links">
            <FigureRelationshipsPanel
              figure={figure}
              state={state}
              activeMomentId={activeMomentId}
              onState={onState}
              onRequestDelete={(edge, name) => setDeleteEdge({ edge, name })}
            />
          </TabPanel>
          <Button
            className="figure-inspector-delete"
            tone="danger"
            icon={<Trash2 />}
            onClick={onDelete}
          >
            {t("deleteKind").replace("{kind}", kindLabel(figure.type, t))}
          </Button>
        </SidePanelBody>
      </Tabs>
      {deleteEdge && (
        <ConfirmDialog
          title={t("deleteConnection")}
          description={t("deleteConnectionDescription", { name: deleteEdge.name })}
          supportingText={t("undoHint", { shortcut: storyShortcutLabel("Z", locale) })}
          closeLabel={t("closeDialog")}
          cancelLabel={t("cancel")}
          confirmLabel={t("deleteConnection")}
          onConfirm={() =>
            onState({
              ...state,
              edges: state.edges.filter((item) => item.id !== deleteEdge.edge.id),
            })
          }
          onClose={() => setDeleteEdge(null)}
        />
      )}
    </>
  );
}
