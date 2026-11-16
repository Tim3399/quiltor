# Deutsche Schreibwerkzeuge

Für Manuskripte mit Schreibsprache `de-DE` stehen lokal zur Verfügung:

- Wörterbuch
- Synonyme
- Wortübersetzung
- Rechtschreibprüfung
- Grammatikprüfung

Markierter Text kann nachgeschlagen werden. Einfügen, Ersetzen und Korrigieren geschieht erst nach einer ausdrücklichen Aktion und bleibt per Undo rückgängig machbar.

Das geführte Setup installiert die Sprachwerkzeuge standardmäßig:

```bash
quiltor install
```

Daten liegen unter:

```text
data/writing-assistance/
```

bei pipx/CLI-Installationen standardmäßig unter:

```text
~/.quiltor/data/writing-assistance/
```

Bestehende Daten aus dem früheren Verzeichnis `data/language/` werden beim ersten Start
automatisch und sicher übernommen; ein manueller Umzug ist nicht nötig.

LanguageTool benötigt **Java 17+**. Ohne LanguageTool bleibt die Rechtschreibprüfung des Browsers verfügbar.

Externe LanguageTool-kompatible Dienste werden ausschließlich verwendet, wenn:

```bash
QUILTOR_LANGUAGETOOL_EXTERNAL_OPT_IN=1
```

gesetzt ist. Ohne Opt-in verlassen Kapiteltexte und Suchbegriffe für diese Funktion das Gerät nicht.

Für Server ohne Java, etwa das Docker-Image, gibt es einen LanguageTool-Server als eigenen Dienst:

```bash
QUILTOR_LANGUAGETOOL_URL=http://languagetool:8010
QUILTOR_LANGUAGETOOL_EXTERNAL_OPT_IN=1
```

Mit beiden Werten läuft die Grammatikprüfung über diesen Server. Die Schreibhilfe zeigt dann
weder den Installieren-Knopf noch den Java-Hinweis. Ist nur die URL gesetzt, meldet sie ohne lokale
Installation, dass der Dienst eingetragen, aber nicht freigegeben ist; mit installiertem JAR und Java
gilt sie als bereit, und der Hinweis „nicht freigegeben“ erscheint erst als Fehler beim Prüfen. Antwortet der Server nicht, erscheint
„Die Grammatikprüfung antwortet gerade nicht.“ (Fehlercode `writing_assistance.grammar_unavailable`).
Quiltor schreibt dabei keinen Kapiteltext ins Log oder in Fehlermeldungen.

## Sprachdaten für Wörterbuch, Synonyme und Übersetzung

Die Daten sind ein vorgebautes Datenpaket aus einem eigenen Daten-Release. Sie werden nachgeladen und nicht mit Quiltor ausgeliefert. Beim Installieren prüft Quiltor Größe und Prüfsumme, bevor es die Daten übernimmt. Sie stammen aus dem deutschen Wiktionary und aus OpenThesaurus und stehen als Ganzes unter CC BY-SA 4.0.

Version 3.25.0 erscheint noch ohne veröffentlichtes Paket. Die Oberfläche zeigt dann „Die Sprachdaten folgen mit einem späteren Update.“, und `quiltor install` kann die Daten noch nicht laden. Die Rechtschreibprüfung des Browsers bleibt verfügbar.

Wer Quiltor als Server betreibt, installiert die Daten selbst: einmal `quiltor install` auf dem Server, sobald ein Paket veröffentlicht ist. Die Datei liegt im Datenverzeichnis, beim Docker-Image also im Volume `/data`, und überlebt ein Image-Update. Ein Server lädt von sich aus nichts nach.

Quellen, Versionen, Checksummen, Lizenzen und Attributionen stehen im Installationsmanifest und in [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md).
