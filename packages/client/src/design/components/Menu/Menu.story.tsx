import { Copy, FolderInput, Grid3X3, Lock, Pencil, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "../../primitives/Button";
import { Popover } from "../Popover";
import { Menu, MenuItem, MenuItemCheckbox, MenuSeparator, MenuSubmenu } from "./Menu";

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

/** The way menus open in the product: inside a popover, which is a modal sheet on compact. */
export function SubmenuInPopover() {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState("");
  return (
    <>
      <Button ref={trigger} onClick={() => setOpen((current) => !current)}>
        Kapitelaktionen
      </Button>
      <output>{chosen}</output>
      <Popover
        anchorRef={trigger}
        open={open}
        label="Kapitelaktionen"
        desktopRole="presentation"
        onClose={() => setOpen(false)}
      >
        <Menu label="Kapitelaktionen" onClose={() => setOpen(false)}>
          <MenuItem icon={<Pencil />} label="Umbenennen" onSelect={() => setChosen("Umbenennen")} />
          <MenuSubmenu icon={<FolderInput />} label="Verschieben nach">
            <MenuItem label="Akt 1 · Ankunft" onSelect={() => setChosen("Akt 1 · Ankunft")} />
            <MenuItem label="Ohne Ordner" onSelect={() => setChosen("Ohne Ordner")} />
          </MenuSubmenu>
        </Menu>
      </Popover>
    </>
  );
}

/** Settings with a fixed name and a check mark, next to plain actions (T-258). */
export function CheckableSettings() {
  const [grid, setGrid] = useState(true);
  const [bound, setBound] = useState(false);
  return (
    <Menu label="Weitere Aktionen" onClose={() => undefined} autoFocus={false}>
      <MenuItemCheckbox
        icon={<Grid3X3 />}
        label="Am Raster ausrichten"
        checked={grid}
        onCheckedChange={setGrid}
      />
      <MenuItemCheckbox
        icon={<Lock />}
        label="An die Karte binden"
        checked={bound}
        onCheckedChange={setBound}
      />
      <MenuItemCheckbox
        label="Ohne Karte nicht verfügbar"
        checked={false}
        disabled
        onCheckedChange={() => undefined}
      />
      <MenuSeparator />
      <MenuItem icon={<Copy />} label="Duplizieren" onSelect={() => undefined} />
    </Menu>
  );
}
