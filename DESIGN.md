# Quiltor · Werkstatt

Quiltor ist eine lokale Schreibwerkstatt für deutschsprachige Autorinnen und Autoren.
Die Hauptaufgabe ist das eigene Schreiben, begleitet von Figuren, Orten, Timeline und
Storyboard. Arbeitsannahme: wiederholte, längere Sitzungen am Desktop; schmale Ansichten
bleiben für dieselben Aufgaben bedienbar. Manuskriptverlust und unbemerkte Änderungen
sind besonders teuer. Eine erfolgreiche Rückkehr führt zur eigenen Textstelle und zeigt
einen nachvollziehbaren Speicherzustand.

Die mit dem Eigentümer gewählte Richtung lautet: **Struktur links, das Schreibblatt in
der Mitte, Steuerung rechts.** Dieser Brief hält den vorhandenen Werkstattcharakter fest;
er ist kein Auftrag für weitere Layoutumbauten.

| Feld         | Entscheidung                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typografie   | Serifenschrift trägt Manuskript und charakteristische Überschriften; die UI-Schrift trägt Bedienung. Kleine Kapitälchen und alte Ziffernformen geben den vorhandenen Akzent. Textrollen unterscheiden Titel, Arbeitsinhalt, Bedienung, Beschriftung, Metadaten und Zahlen. Im Versionsvergleich steht Manuskript in der freigegebenen 16-px-Serifendarstellung, technischer Dateiinhalt in 14-px-Monospace. Die übrige Größenskala bleibt erhalten; der [Typografie-Audit](docs/design/typography-audit.md) dokumentiert Befunde und Zuordnung. |
| Farbe        | Warme, abgestufte Arbeitsflächen in Hell und Dunkel. Gold markiert den aktiven Arbeitskontext. Moss bestätigt und markiert Hinzugefügtes, Rose Fehler und Entferntes, Copper Warnungen. Ink Blue gehört Fokus und Information. Farbwerte und Kontrastrollen stehen ausschließlich in [colors.css](packages/client/src/design/colors.css).                                                                                                                                                                                                       |
| Raum         | Das Manuskript liegt als erkennbares Blatt auf einer dunkleren Arbeitsfläche. Binder und Inspector behalten ihre eigene Fläche und Kontur. Die Satzbreite wächst bis zur bestehenden gemeinsamen Lesebreite; Fokusmodus und normale Ansicht bleiben dasselbe Blatt. Die vier Spacing-Rhythmen stehen im [Systemvertrag](packages/client/src/design/README.md).                                                                                                                                                                                  |
| Ausarbeitung | Vorhandene Konturen, Radien und Tiefe erklären Ebenen. Die bestehende Icon-Familie bleibt konsistent. Häufige Texteingaben und Ansichtswechsel brauchen unmittelbare Reaktion; Bewegung erklärt gelegentliche Zustandswechsel. Speicherstatus, Zeitpunkt und nachvollziehbare Rücknahme unterstützen die Arbeit.                                                                                                                                                                                                                                |

Zwei konkrete Referenzen innerhalb des Produkts:

- [Manuskriptansicht](docs/screenshots/manuscript.png): links strukturieren, in der Mitte
  schreiben, rechts begleiten; eigenständige Flächen machen die drei Aufgaben lesbar.
- [Kapitelverlauf](packages/client/src/modules/manuscript/ChapterHistoryPanel.css): Lesetext
  bleibt Arbeitsinhalt; Wortänderungen verbinden lesbare Textrollen mit einer Markierung,
  die zusätzlich zur Farbe erkennbar ist. Der allgemeine Verlauf übernimmt diesen Vertrag.

Ausdrücklich unerwünscht sind ein austauschbarer blauer Markenauftritt und eine dauerhaft
rahmenlose Oberfläche, die häufige Werkzeuge oder die Gliederung für einen ruhigeren
Screenshot verschwinden lässt. Die reduzierte Bühne bleibt ein Fokusmodus.

Die am 12. September 2026 zur autonomen Umsetzung übergebenen Detailfragen sind entschieden:

- **Timeline und Orte** behalten ihre räumlichen Arbeitsflächen. Das Schreibblatt gehört zum
  fortlaufenden Manuskript; Beziehungen, Zeit und Karten brauchen ihre bestehende freie Anordnung.
- **Fokusmodus:** Die schmale Kapitelspur bleibt erhalten. Die Kapitelliste öffnet sich bei Bedarf;
  der Kapitelwechsel führt den Tastaturfokus zurück in den Editor. Die Schreibhilfe funktioniert
  entsprechend, ohne die Satzbreite beim Öffnen zu verändern.
- **Elementtypen:** Die vorhandenen Icons, Formen und ausgeschriebenen Typbezeichnungen bleiben
  die Erkennungsmerkmale. Es kommt keine weitere kategoriale Palette hinzu. Bestehende semantische
  Farben behalten ihre Bedeutung.
- **Lesbarkeit:** Arbeitsbeschriftungen und Feldlabels beginnen bei 12 px, längere
  Assistentenvorschläge bei 14 px. Technische Listen und Protokolle verwenden 12-px-Monospace;
  der freigegebene Versionsvergleich bleibt bei 16-px-Serif beziehungsweise 14-px-Monospace.
  Kleine Zähler, Badges und ergänzende Metadaten behalten ihre bewusste sekundäre Rolle.

Die beiden internen Referenzen oben sind damit die Arbeitsreferenzen für diese Umsetzung.
Begründung und Prüfnachweise: [Design-Nacharbeit](docs/design/followup-review-2026-09-12.md).

Allgemeine Qualität: [Frontend Styleguide](docs/design/FRONTEND_STYLEGUIDE.md).
Technische Quellen: [tokens.css](packages/client/src/design/tokens.css),
[typography.css](packages/client/src/design/typography.css) und die jeweils zuständigen Komponenten.
