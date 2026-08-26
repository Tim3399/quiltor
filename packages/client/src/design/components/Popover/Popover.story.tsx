import { useRef, useState } from "react";
import { Button } from "../../primitives/Button";
import { Popover } from "./Popover";

export function Default() {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button ref={trigger} onClick={() => setOpen((current) => !current)}>
        Popover öffnen
      </Button>
      <Popover anchorRef={trigger} open={open} label="Werkzeuge" onClose={() => setOpen(false)}>
        <div style={{ padding: 16 }}>Verankerter Inhalt</div>
      </Popover>
    </>
  );
}

export function OpenNearEdge() {
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div style={{ minHeight: 240, display: "flex", justifyContent: "flex-end" }}>
      <Button ref={trigger}>Auslöser am Rand</Button>
      <Popover anchorRef={trigger} open label="Randposition" onClose={() => undefined}>
        <div style={{ width: 280, padding: 16 }}>Langer Inhalt bleibt im Viewport.</div>
      </Popover>
    </div>
  );
}
