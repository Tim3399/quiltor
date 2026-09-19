# Deine ersten Schritte mit Quiltor

Zum lokalen Schreiben brauchst du weder ein Cloud-Konto noch ein KI-Modell.
Eine „Welt“ ist dein Projekt: Manuskript, Figuren, Orte und Planung gehören zusammen.

## Installieren und öffnen

Die direkte Desktop-Paketierung unterstützt Windows x86_64 und macOS mit Apple
Silicon. Wähle bei den [veröffentlichten Paketen](https://github.com/Tim3399/quiltor/releases)
das passende Paket deiner Version. Nicht jede Vorabversion enthält fertige Installer.

1. **Windows:** Öffne `Quiltor-Setup-<version>.exe`, folge den Installationsschritten
   und starte Quiltor anschließend über das Startmenü.
2. **macOS mit Apple Silicon:** Öffne das passende `.dmg`, kopiere Quiltor in
   „Programme“ und starte es dort.
3. Lass **Cloud-Backup (optional)** leer, wenn du keinen eigenen kompatiblen
   Backup-Dienst eingerichtet hast.
4. Öffne eine Welt oder wähle **Neue Welt**, gib einen Titel ein und wähle
   **Welt erstellen**. Eine KI-Einrichtung ist dafür nicht erforderlich.

Wenn kein passendes Desktop-Paket vorliegt, beschreibt der
[technische Schnellstart](../README.md#schnellstart) den lokalen Browserbetrieb.
Diese Anleitung verspricht keine Store-, Mobil- oder Linux-Desktop-Ausgabe.
Bei einer gehosteten Webseite liegen die Projektdaten auf deren Server.

## Mit einer Aufgabe beginnen

| Aufgabe                     | Einstieg                                                                                                                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schreiben                   | Öffne **Text**, wähle **Neues Kapitel** und beginne im Kapiteltext.                                                                                                                                                              |
| Vorhandenen Text übernehmen | Lege ein Kapitel an und füge deinen Text aus der bisherigen Anwendung ein. Prüfe Absätze, Formatierungen und Links. Übernimm längere Texte kapitelweise. Für ein vollständiges Quiltor-Projekt verwende **Projekt importieren**. |
| Eine Figur nachschlagen     | Öffne **Suchen & Befehle**, suche ihren Namen und öffne den Treffer. **Text** bringt dich zum zuletzt bearbeiteten Kapitel zurück.                                                                                               |
| Weltwissen vorbereiten      | Öffne den Assistenten und wähle ausdrücklich die zu berücksichtigenden Kapitel. Richte das lokale Modell erst für diese Funktion ein und prüfe Vorschläge vor dem Übernehmen.                                                    |

Der Assistent schreibt oder überarbeitet keine Romanprosa. Standardanalysen
berücksichtigen Kapitel im Buch. Zurückgestellte Kapitel sind ausdrücklich auswählbar;
gelöschte Kapitel sind ausgeschlossen.

## Entwürfe behalten und Gelöschtes zurückholen

**Aus dem Buch nehmen** stellt ein Kapitel zurück. Text, Notizen und Verweise
bleiben erhalten. Der Filter **Zurückgestellt** findet es wieder; Buchansicht,
Buchumfang und Buchexport lassen es aus. **Wieder ins Buch aufnehmen** nimmt
dasselbe Kapitel erneut auf.

| Inhalt                       | Lösch- und Wiederherstellungsregel                                                                                                                                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kapitel                      | **Kapitel löschen** verschiebt es in den beschrifteten **Papierkorb** der Kapitelnavigation. Suche dort Titel oder Text, prüfe die Vorschau und wähle **Kapitel wiederherstellen**. Sein Buchstatus bleibt erhalten. Fehlt der ursprüngliche Ordner, wird die oberste Ebene als Ziel erklärt. |
| Kapitelordner                | Seine Inhalte bleiben erhalten und wechseln in die übergeordnete Ebene.                                                                                                                                                                                                                       |
| Ganze Welt                   | Papierkorb in der Weltauswahl; Wiederherstellung erhält lokale Sicherungen und Verlauf.                                                                                                                                                                                                       |
| Weltelemente und Storyboards | Noch kein eigener dauerhafter Papierkorb. Nutze unmittelbar das vorhandene Rückgängig oder eine vorherige Sicherung. Fehlende Referenzziele werden gekennzeichnet.                                                                                                                            |
| Storyboard-Referenzkarte     | Entfernt nur die Karte, nicht das ursprüngliche Kapitel oder Weltelement.                                                                                                                                                                                                                     |

Der Papierkorb leert sich nicht automatisch. **Endgültig löschen** ist eine eigene
bestätigte Aktion. Sie löscht keine Kopien auf einem separat betriebenen Backup-Server.

## Ausgabe, Übertragung und Sicherung unterscheiden

| Funktion                          | Umfang                                                                                                                                                                                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Buch exportieren                  | Aktuelle Buchfassung ohne zurückgestellte und gelöschte Kapitel.                                                                                                                                                                                          |
| Projekt exportieren / importieren | Aktuelles Projekt als `.quiltor`, einschließlich zurückgestellter Kapitel, Kapitelpapierkorb und benötigter Bilder. Ohne Versionsverlauf und frühere Sicherungen. Import erstellt eine neue Welt; Konten und Backup-Zugangsdaten werden nicht übernommen. |
| Sicherung wiederherstellen        | Vorschau einer lokalen Sicherung; vor dem Ersetzen wird der aktuelle gespeicherte Zustand nochmals gesichert. Der Dialog zeigt Speicherort und letzte lokale Sicherung.                                                                                   |
| Arbeitsstand sichern              | Benannter Stand im Verlauf; optionaler Upload an einen konfigurierten Backup-Server.                                                                                                                                                                      |

Bei **Speichern fehlgeschlagen** bleibt dein Entwurf im Editor. **Entwurf retten**
ermöglicht Kopieren und Herunterladen. Die zusätzliche JSON-Rettung enthält die
geladenen Projektdokumente, jedoch keine Bilddateien oder früheren Sicherungen.
Sie ist kein vollständiger Projekttransfer.

Bei konkurrierenden Sitzungen kannst du die gespeicherte Fassung vergleichen.
Sichere beide Fassungen, bevor du ausdrücklich eine davon weiterverwendest.
Lade den Browser nicht vorschnell neu.

Lokales Schreiben und lokale Rettungswege benötigen kein Cloud-Abo. Ein Ausfall
des Remote-Backups sperrt sie nicht. Automatische Synchronisation zwischen Geräten
wird derzeit nicht angeboten.
