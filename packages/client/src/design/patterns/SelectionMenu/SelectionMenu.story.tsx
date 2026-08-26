import { Copy, Scissors, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "../../primitives/Button";
import { SelectionMenu } from "./SelectionMenu";

export function Default() {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button ref={anchor} onClick={() => setOpen((current) => !current)}>
        Auswahlaktionen
      </Button>
      <SelectionMenu
        anchorRef={anchor}
        open={open}
        label="Auswahlaktionen"
        onClose={() => setOpen(false)}
        actions={[
          { id: "cut", label: "Ausschneiden", shortcut: "⌘X", icon: <Scissors />, run() {} },
          { id: "copy", label: "Kopieren", shortcut: "⌘C", icon: <Copy />, run() {} },
          {
            id: "assist",
            label: "Schreibhilfe",
            icon: <Sparkles />,
            separatorBefore: true,
            run() {},
          },
        ]}
      />
    </>
  );
}

export function DisabledAction() {
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={anchor}>Auswahlaktionen</Button>
      <SelectionMenu
        anchorRef={anchor}
        open
        label="Auswahlaktionen"
        onClose={() => undefined}
        actions={[
          { id: "copy", label: "Kopieren", shortcut: "⌘C", run() {} },
          { id: "paste", label: "Einfügen", shortcut: "⌘V", disabled: true, run() {} },
        ]}
      />
    </>
  );
}

export function LongManyActions() {
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={anchor}>Umfangreiche Auswahlaktionen</Button>
      <SelectionMenu
        anchorRef={anchor}
        open
        label="Umfangreiche Auswahlaktionen"
        onClose={() => undefined}
        actions={Array.from({ length: 24 }, (_, index) => ({
          id: `action-${index}`,
          label:
            index === 23
              ? "Ausgewählten Text mit einer besonders ausführlichen Beschreibung bearbeiten"
              : `Auswahlaktion ${String(index + 1).padStart(2, "0")}`,
          run() {},
        }))}
      />
    </>
  );
}
