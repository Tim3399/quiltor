import { BookOpen, CloudOff, Cpu, LoaderCircle, TriangleAlert } from "lucide-react";
import { StatusBar, StatusBarItem } from "./StatusBar";

export function Tones() {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <StatusBar
        label="Status"
        start={
          <>
            <StatusBarItem icon={<BookOpen />}>4 Kapitel · 0,2 Normseiten</StatusBarItem>
            <StatusBarItem>Kapitel 1 von 4</StatusBarItem>
          </>
        }
        end={<StatusBarItem tone="success">Gespeichert · vor 5 Min.</StatusBarItem>}
      />
      <StatusBar
        label="Status beim Speichern"
        start={<StatusBarItem icon={<BookOpen />}>4 Kapitel · 0,2 Normseiten</StatusBarItem>}
        end={
          <>
            <StatusBarItem icon={<Cpu />} tone="info">
              Assistent lokal · bereit
            </StatusBarItem>
            <StatusBarItem icon={<LoaderCircle />}>Wird gespeichert</StatusBarItem>
          </>
        }
      />
      <StatusBar
        label="Status mit Vorwarnung"
        start={<StatusBarItem icon={<BookOpen />}>4 Kapitel · 0,2 Normseiten</StatusBarItem>}
        end={
          <StatusBarItem icon={<TriangleAlert />} tone="warning">
            Kein Schnappschuss seit gestern
          </StatusBarItem>
        }
      />
      <StatusBar
        label="Status im Fehlerfall"
        start={<StatusBarItem icon={<BookOpen />}>4 Kapitel · 0,2 Normseiten</StatusBarItem>}
        end={
          <StatusBarItem icon={<CloudOff />} tone="danger">
            Nicht gespeichert
          </StatusBarItem>
        }
      />
    </div>
  );
}

export function LongContent() {
  return (
    <StatusBar
      label="Status mit langen Angaben"
      start={
        <>
          <StatusBarItem icon={<BookOpen />}>
            Ein Kapitel mit einem ungewöhnlich langen und erklärenden Arbeitstitel
          </StatusBarItem>
          <StatusBarItem>128 Kapitel · 1.204,5 Normseiten</StatusBarItem>
        </>
      }
      end={<StatusBarItem tone="success">Gespeichert · gestern</StatusBarItem>}
    />
  );
}

export function OneSideOnly() {
  return <StatusBar label="Status ohne Kontext" end={<StatusBarItem>Bereit</StatusBarItem>} />;
}
