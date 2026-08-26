import { Chip, ChipAction, ChipList, RemovableChip } from "./Chip";

export function Variants() {
  return (
    <ChipList label="Begriffe">
      <Chip>Hafen</Chip>
      <Chip tone="accent">Wichtig</Chip>
      <ChipAction selected>Meer</ChipAction>
      <RemovableChip removeLabel="Sturm entfernen" onRemove={() => undefined}>
        Sturm
      </RemovableChip>
    </ChipList>
  );
}

export function LongWrappingList() {
  return (
    <ChipList label="Lange Begriffe">
      <Chip>Weltenchronologiequellenverzeichnisverwaltungskatalogeintragsnummernregister</Chip>
      <RemovableChip removeLabel="Begriff entfernen" onRemove={() => undefined}>
        Figurenbeziehungsentwicklungschronologiequellenverzeichniseintrag
      </RemovableChip>
      <ChipAction>Handlungszeitraumzuordnungsentscheidungsvorschlagsauswahl</ChipAction>
    </ChipList>
  );
}
