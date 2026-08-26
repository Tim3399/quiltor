import { Copy, Pencil, Trash2 } from "lucide-react";
import { Menu, MenuItem, MenuSeparator } from "./Menu";

export function Default() {
  return (
    <Menu label="Aktionen" onClose={() => undefined} autoFocus={false}>
      <MenuItem icon={<Pencil />} label="Umbenennen" shortcut="F2" onSelect={() => undefined} />
      <MenuItem icon={<Copy />} label="Duplizieren" shortcut="⌘D" onSelect={() => undefined} />
      <MenuSeparator />
      <MenuItem icon={<Trash2 />} label="Löschen" tone="danger" onSelect={() => undefined} />
    </Menu>
  );
}

export function DisabledAndSelected() {
  return (
    <Menu label="Ansicht" onClose={() => undefined} autoFocus={false}>
      <MenuItem label="Raster" selected onSelect={() => undefined} />
      <MenuItem label="Zeitstrahl" disabled onSelect={() => undefined} />
    </Menu>
  );
}
