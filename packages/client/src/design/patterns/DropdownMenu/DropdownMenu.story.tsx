import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { MenuItem, MenuSeparator } from "../../components/Menu";
import { ToolbarButton } from "../../components/ToolbarButton";
import { DropdownMenu } from "./DropdownMenu";

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
