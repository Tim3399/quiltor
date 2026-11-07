import { MapPin } from "lucide-react";
import { useState } from "react";
import { CollapsibleGroup } from "./CollapsibleGroup";

function Group({ initiallyOpen, title }: { initiallyOpen: boolean; title: string }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <CollapsibleGroup
      id={`story-${title.length}-${initiallyOpen}`}
      icon={<MapPin />}
      title={title}
      count={3}
      open={open}
      onOpenChange={setOpen}
    >
      <ul>
        <li>Hafenmeisterei</li>
        <li>Leuchtturm</li>
        <li>Der Kai</li>
      </ul>
    </CollapsibleGroup>
  );
}

export function Open() {
  return <Group initiallyOpen title="Ort" />;
}

export function Closed() {
  return <Group initiallyOpen={false} title="Ort" />;
}

export function LongContent() {
  return <Group initiallyOpen title="Ein Gruppentitel, der deutlich länger ist als der Platz" />;
}
