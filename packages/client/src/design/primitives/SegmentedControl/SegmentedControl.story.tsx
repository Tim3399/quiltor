import { useState } from "react";
import { SegmentedControl } from "./SegmentedControl";

const options = [
  { value: "cards", label: "Karten" },
  { value: "list", label: "Liste" },
  { value: "timeline", label: "Zeitstrahl" },
] as const;

export function Default() {
  const [value, setValue] = useState<(typeof options)[number]["value"]>("cards");
  return (
    <SegmentedControl label="Darstellung" value={value} options={options} onChange={setValue} />
  );
}

export function DisabledOption() {
  return (
    <SegmentedControl
      label="Darstellung"
      value="cards"
      options={[...options, { value: "future", label: "Bald verfügbar", disabled: true }]}
      onChange={() => undefined}
    />
  );
}

export function Touch() {
  return (
    <SegmentedControl
      label="Darstellung"
      value="list"
      options={options}
      onChange={() => undefined}
      size="touch"
    />
  );
}
