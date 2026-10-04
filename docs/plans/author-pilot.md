# S17 first-use author pilot

Status: deferred by the owner on 2026-10-03; retained as a proposed research plan.
No sessions have been recruited, run or analyzed. This
document defines the fixed pilot; it contains no participant results or product findings.
S17 remains dependent on real participants.

## Purpose and recruitment proposal

The pilot tests whether a German-speaking author can complete Quiltor's main first-use
workflow without coaching: begin a manuscript, bring in existing text, connect story-world
knowledge, recover earlier writing, and export a reviewable book. Record observed friction
before choosing corrections.

Recruit three to five real authors who write long-form German prose. Seek a small mix of
people who are comfortable and uncomfortable with specialist writing software, and include
different screen sizes or accessibility needs when volunteers disclose them. This is a
recruitment proposal, not a completed sample. Do not contact anyone or schedule sessions as
part of this plan.

Use the same tested build and fixed task order for every participant. Begin from a fresh
local profile. Provide purpose-made sample DOCX and Markdown manuscripts with fictional
content, known chapter boundaries, formatting, warnings and nested-folder expectations.
The researcher may ask the participant to think aloud but must not name controls, describe
the intended route or correct an action while a task remains active. If the participant is
blocked for three minutes, offer one neutral rescue prompt and record the task as assisted.

## Consent and privacy

Before beginning, explain the study, the data being recorded, the voluntary nature of the
session and the participant's right to stop. Obtain explicit consent for observation and
separate opt-in consent for audio, video or screen recording. Assign a participant code;
do not put names or contact details in the observation sheet.

Use the supplied fictional fixtures by default. Participants must not upload or paste a
personal manuscript, unpublished writing or personal story-world data. If a participant
wants to use personal material, stop and arrange a separately approved process rather than
accepting it during this pilot. Record only the minimum needed to understand an interaction.
Agree on retention and deletion dates before each session, store notes in the approved
project location, and remove local pilot projects and exported files after verification.

Read this fixed opening to each participant:

> Wir testen heute die Bedienung von Quiltor, nicht dich. Bitte sag laut, was du erwartest
> und was dich irritiert. Ich helfe erst, wenn du feststeckst, und notiere dann die Hilfe.
> Verwende bitte nur die bereitgestellten Beispieldateien und keine eigenen Manuskripte.
> Du kannst jederzeit pausieren oder abbrechen.

## Fixed participant tasks

Give one prompt at a time. Do not reveal later tasks or the completion criteria.

### 1. Start writing

Participant prompt:

> Lege ein neues Projekt mit dem Titel „Die letzte Fähre“ an. Erstelle darin ein Kapitel
> „Ankunft“ und schreibe zwei kurze Absätze. Hebe ein Wort fett und ein anderes kursiv hervor.
> Öffne danach ein anderes Kapitel oder einen anderen Bereich und kehre zu „Ankunft“ zurück.

Completion criteria: the new world exists; the named chapter contains two paragraphs and
both formatting kinds; leaving and returning preserves the exact text and formatting.

### 2. Review and merge a DOCX import

Participant prompt:

> Importiere die bereitgestellte Datei „Hafenentwurf.docx“ als neues Projekt. Prüfe vor dem
> Import, was übernommen wird und was nicht. Fasse in der Vorschau die beiden Kapitel
> „Nachtfahrt“ und „Morgengrauen“ zu einem Kapitel mit dem Titel „Überfahrt“ zusammen und
> schließe den Import ab.

Completion criteria: the participant finds the import flow, examines the preview and loss
warnings, merges only the requested adjacent chapters, acknowledges warnings deliberately,
and creates one project with the expected text, order and bold/italic formatting.

### 3. Organize a Markdown import

Participant prompt:

> Importiere die bereitgestellte Datei „Inselnotizen.md“ als neues Projekt. Ordne in der
> Vorschau die Kapitel „Leuchtturm“ und „Sturm“ dem Ordner „Teil Eins“ zu. In der
> Kapitelreihenfolge soll „Sturm“ unmittelbar auf „Leuchtturm“ folgen. Prüfe das nach dem Import.

Completion criteria: the participant previews the Markdown source, creates or selects the
requested folder mapping, imports once, and the binder retains the expected folder, chapter
order, text and formatting after reopening the project.

### 4. Connect manuscript and story world

Participant prompt:

> Lege in „Die letzte Fähre“ eine Figur namens „Mara Voss“ mit einer kurzen Notiz an. Stelle
> im Kapitel „Ankunft“ eine Verbindung zu dieser Figur her. Ändere anschließend die Notiz der
> Figur und prüfe, ob du vom Manuskript aus weiterhin zur richtigen Figur gelangst.

Completion criteria: one figure exists, the manuscript reference resolves to that figure,
the note edit persists, and the reference remains intact without duplicating the figure or
changing manuscript text.

### 5. Recover an earlier version

Participant prompt:

> Ergänze in „Ankunft“ am Ende den Satz „Die Glocke schwieg.“ Ändere ihn danach zu
> „Die Glocke rief.“ Stelle anschließend die frühere Fassung mit „schwieg“ wieder her und
> kontrolliere den Kapiteltext.

Completion criteria: the participant finds version history, identifies the intended prior
state, restores it, and the final chapter contains the earlier sentence with surrounding
text and formatting unchanged.

### 6. Export a DOCX review copy

Participant prompt:

> Erstelle aus „Die letzte Fähre“ eine DOCX-Fassung fürs Lektorat. Prüfe vor dem Download,
> welche Kapitel und Hinweise angezeigt werden. Lade die Datei erst herunter, wenn du mit
> dem angezeigten Inhalt einverstanden bist.

Completion criteria: the participant selects the editorial DOCX preset, reviews chapter
scope and warnings, acknowledges warnings knowingly, downloads one DOCX file, and the
source project remains unchanged.

### 7. Export an EPUB reading copy

Participant prompt:

> Trage für „Die letzte Fähre“ den Autorennamen „Mara Beispiel“ ein. Erstelle danach eine
> EPUB-Fassung für einen E-Reader. Prüfe Titel, Autor, Sprache, Kapitelreihenfolge und Hinweise
> vor dem Download und lade die Datei herunter.

Completion criteria: the displayed metadata matches the saved project, included chapters
are in binder order, warnings are reviewed and acknowledged, one EPUB file downloads, and
the source project remains unchanged.

## Observation sheet

Create one sheet per participant. Use elapsed time from prompt completion to either success,
assisted success or stop. Preserve concise behavioral notes and exact participant wording;
do not infer motivation during the session.

| Field                | Record                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| Participant          | Anonymous code; relevant writing-software experience volunteered by the participant                     |
| Environment          | Quiltor build, browser/native host, operating system, device, viewport, input method                    |
| Accessibility        | Participant-requested settings or assistive technology; text scaling, zoom, keyboard-only use           |
| Task result          | Independent success, assisted success, or not completed; completion criterion that failed               |
| Time                 | Start, finish and elapsed time; exclude researcher or technical interruption                            |
| Route                | Controls and screens used, including reversals or abandoned routes                                      |
| Hesitation           | Timestamp and visible behavior: pause, repeated scan, backtrack, or request for help                    |
| Errors and recovery  | User-visible error, triggering action, comprehension, recovery route, rescue prompt if any              |
| Data integrity       | Expected versus observed text, formatting, order, folders, references, versions and source preservation |
| Accessibility/device | Focus, labels, target reachability, clipping, reflow, contrast concern, assistive-technology behavior   |
| Evidence             | Short anonymized quote or observation; optional recording timestamp when separately consented           |
| Follow-up            | Neutral question asked after the task and the participant's answer                                      |

After all tasks, ask these fixed, non-leading questions in German:

> Was war für dich am schwersten zu finden oder zu verstehen?

> Gab es einen Moment, in dem du deinen Text oder deine Änderungen für gefährdet gehalten hast?

> Welche eine Änderung würde deinen nächsten Arbeitsgang am meisten erleichtern?

## Analysis and exit criteria

Check completion criteria against the saved projects and downloaded files after each task;
do not treat a participant's confidence alone as success. Aggregate task success, assisted
success, median time and recurring hesitation points. Keep isolated preferences separate
from repeated obstacles.

Prioritize observed friction in this order:

1. Data loss, incorrect export/import, broken recovery, privacy or accessibility blockers.
2. Failures that prevent task completion or require researcher rescue for more than one
   participant.
3. Repeated hesitation, misleading wording or recoverable errors that materially slow a task.
4. Individual preferences and polish requests, retained as hypotheses until corroborated.

For every proposed correction, cite the anonymized task evidence, define the smallest
behavior change and add a targeted acceptance check. Do not mark S17 accepted until real
sessions have recorded outcomes and the selected corrections have been implemented and
verified. If recruitment does not occur, report the pilot as unrun and the participant
dependency as open.
