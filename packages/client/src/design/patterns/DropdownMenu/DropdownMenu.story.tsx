import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { MenuItem, MenuSeparator } from "../../components/Menu";
import { ToolbarButton } from "../../components/ToolbarButton";
import { DropdownMenu } from "./DropdownMenu";

const longMenuLabels = [
  "Aktion 01",
  "Aktion 02",
  "Aktion 03",
  "Aktion 04",
  "Aktion 05",
  "Aktion 06",
  "Aktion 07",
  "Aktion 08",
  "Aktion 09",
  "Aktion 10",
  "Aktion 11",
  "Aktion 12",
  "Aktion 13",
  "Aktion 14",
  "Aktion 15",
  "Aktion 16",
  "Aktion 17",
  "Das Element mit einer besonders langen Bezeichnung endgültig löschen",
] as const;

export function Default() {
  return (
    <DropdownMenu
      label="Elementaktionen"
      renderTrigger={({ ref, ...props }) => (
        <ToolbarButton ref={ref} {...props} label="Mehr" icon={<MoreHorizontal />} />
      )}
    >
      <MenuItem icon={<Pencil />} label="Umbenennen" onSelect={() => undefined} />
      <MenuSeparator />
      <MenuItem icon={<Trash2 />} label="Löschen" tone="danger" onSelect={() => undefined} />
    </DropdownMenu>
  );
}

export function InitiallyOpen() {
  return (
    <DropdownMenu
      label="Elementaktionen"
      defaultOpen
      renderTrigger={({ ref, ...props }) => (
        <ToolbarButton ref={ref} {...props} label="Mehr" icon={<MoreHorizontal />} />
      )}
    >
      <MenuItem label="Duplizieren" shortcut="⌘D" onSelect={() => undefined} />
      <MenuItem label="Gesperrt" disabled onSelect={() => undefined} />
    </DropdownMenu>
  );
}

export function LongManyItemsOpen() {
  return (
    <DropdownMenu
      label="Sehr umfangreiche Elementaktionen"
      defaultOpen
      renderTrigger={({ ref, ...props }) => (
        <ToolbarButton ref={ref} {...props} label="Viele Aktionen" icon={<MoreHorizontal />} />
      )}
    >
      {longMenuLabels.map((label) => (
        <MenuItem
          key={label}
          label={label}
          icon={label.startsWith("Das Element") ? <Trash2 /> : <Pencil />}
          tone={label.startsWith("Das Element") ? "danger" : "neutral"}
          onSelect={() => undefined}
        />
      ))}
    </DropdownMenu>
  );
}
