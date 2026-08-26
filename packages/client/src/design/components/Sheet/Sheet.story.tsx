import { useState } from "react";
import { Button } from "../../primitives/Button";
import { Sheet, SheetBody, SheetHeader } from "./Sheet";

const longEntries = Array.from({ length: 18 }, (_, index) => index + 1);

export function Default() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Details öffnen</Button>
      <Sheet open={open} label="Details" onClose={() => setOpen(false)}>
        <SheetHeader title="Details" closeLabel="Schließen" onClose={() => setOpen(false)} />
        <SheetBody>Inhalt der Seitenleiste</SheetBody>
      </Sheet>
    </>
  );
}

export function WideLongContent() {
  return (
    <Sheet open label="Verlauf" onClose={() => undefined} wide>
      <SheetHeader title="Verlauf" closeLabel="Schließen" onClose={() => undefined} />
      <SheetBody>
        {longEntries.map((entry) => (
          <p key={`entry-${entry}`}>Ein längerer, scrollbar bleibender Eintrag {entry}</p>
        ))}
      </SheetBody>
    </Sheet>
  );
}
