import { Copy, FolderInput, Pencil, Trash2 } from "lucide-react";
import { Menu, MenuItem, MenuSeparator, MenuSubmenu } from "./Menu";

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

export function LongLabels() {
  return (
    <Menu label="Kapitelordneraktionen" onClose={() => undefined} autoFocus={false}>
      <MenuItem
        icon={<Pencil />}
        label="Diesen besonders ausführlich benannten Kapitelordner umbenennen"
        onSelect={() => undefined}
      />
      <MenuSeparator />
      <MenuItem
        icon={<Trash2 />}
        label="Diesen Kapitelordner mitsamt seiner sehr langen Bezeichnung löschen"
        tone="danger"
        onSelect={() => undefined}
      />
    </Menu>
  );
}

export function NestedSubmenu() {
  return (
    <Menu label="Kapitelaktionen" onClose={() => undefined}>
      <MenuItem icon={<Pencil />} label="Umbenennen" onSelect={() => undefined} />
      <MenuSubmenu icon={<FolderInput />} label="Verschieben nach">
        <MenuItem label="Akt 1 · Ankunft" onSelect={() => undefined} />
        <MenuItem label="Akt 2 · Entscheidung" onSelect={() => undefined} />
        <MenuItem label="Ohne Ordner" onSelect={() => undefined} />
      </MenuSubmenu>
    </Menu>
  );
}
