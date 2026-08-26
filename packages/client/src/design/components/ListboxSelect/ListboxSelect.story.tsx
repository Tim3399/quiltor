import { useState } from "react";
import { ListboxSelect } from "./ListboxSelect";

const options = [
  { value: "de", label: "Deutsch" },
  { value: "en", label: "Englisch" },
  { value: "fr", label: "Französisch", disabled: true },
] as const;

export function Default() {
  const [value, setValue] = useState<(typeof options)[number]["value"]>("de");
  return <ListboxSelect label="Sprache" value={value} options={options} onChange={setValue} />;
}

export function Disabled() {
  return (
    <ListboxSelect
      label="Sprache"
      value="de"
      options={options}
      onChange={() => undefined}
      disabled
    />
  );
}

export function LongOptions() {
  return (
    <ListboxSelect
      label="Ausgabeformat"
      value="long"
      options={[
        { value: "short", label: "Kurz" },
        { value: "long", label: "Ein sehr lang benanntes Ausgabeformat für schmale Ansichten" },
      ]}
      onChange={() => undefined}
      size="touch"
    />
  );
}
