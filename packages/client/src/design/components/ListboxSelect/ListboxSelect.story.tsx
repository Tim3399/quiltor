import { useState } from "react";
import { Dialog } from "../Dialog";
import { ListboxSelect } from "./ListboxSelect";

const options = [
  { value: "de", label: "Deutsch" },
  { value: "en", label: "Englisch" },
  { value: "fr", label: "Französisch", disabled: true },
] as const;

const longOptions = [
  { value: "short", label: "Kurz" },
  { value: "long", label: "Ein sehr lang benanntes Ausgabeformat für schmale Ansichten" },
  ...Array.from({ length: 18 }, (_, index) => ({
    value: `format-${index + 1}`,
    label: `Weiteres Ausgabeformat ${String(index + 1).padStart(2, "0")}`,
  })),
] as const;

export function Default() {
  const [value, setValue] = useState<(typeof options)[number]["value"]>("de");
  return <ListboxSelect label="Sprache" value={value} options={options} onChange={setValue} />;
}

// A Dialog sits at --z-modal while the listbox portals to the body. The popover layer has to
// stay above the modal layer, or the options render behind the dialog and cannot be clicked.
export function InDialog() {
  const [value, setValue] = useState<(typeof options)[number]["value"]>("de");
  return (
    <Dialog title="Sprache wählen" closeLabel="Dialog schließen" onClose={() => undefined}>
      <ListboxSelect label="Sprache" value={value} options={options} onChange={setValue} />
    </Dialog>
  );
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
      options={longOptions}
      onChange={() => undefined}
      size="touch"
    />
  );
}
