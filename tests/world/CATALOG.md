# Test world catalog

Generated from `tests/world/` by `npm run world:update`. Do not edit; change the parts and
their `PURPOSE` tables instead. Names are the German texts. The base part is photographed
for the README and ships as the example world; the edge part (ids `x-...`) never does.

## Elements

| Id                 | Part | Kind         | Name                                                              | Purpose                                                                                                                                                                 |
| ------------------ | ---- | ------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `oda`              | base | person       | Oda Brandt                                                        | person with a role; leads the Harbour Council                                                                                                                           |
| `rat`              | base | organisation | Hafenrat                                                          | organisation; relationship with a time version (e8)                                                                                                                     |
| `gilde`            | base | organisation | Kartographengilde                                                 | organisation; dashed relationships, one turning rose at t6                                                                                                              |
| `atlas`            | base | objekt       | Der gläserne Atlas                                                | object, favourite (important)                                                                                                                                           |
| `blatt`            | base | objekt       | Das letzte Blatt                                                  | object; target of a chain mara -> blatt -> atlas                                                                                                                        |
| `nordhafen`        | base | ort          | Nordhafen                                                         | root place with its own map picture and scale; city level of three places                                                                                               |
| `iven`             | base | person       | Iven Rook                                                         | person; relationship with two time versions (e1); mentioned in chapter 1                                                                                                |
| `mara`             | base | person       | Mara Venn                                                         | protagonist, favourite; note with headings and four references, alias, two fields                                                                                       |
| `lumen`            | base | tier         | Lumen                                                             | animal; undirected relationship                                                                                                                                         |
| `leuchtturm`       | base | ort          | Leuchtturmklippe                                                  | root place on the world map, without a picture                                                                                                                          |
| `salzmarkt`        | base | ort          | Salzmarkt                                                         | place shown as a pin inside Nordhafen                                                                                                                                   |
| `archive`          | base | ort          | Gezeitenarchiv                                                    | place shown as a card inside Nordhafen; presence of two people                                                                                                          |
| `tilo`             | base | person       | Tilo Krey                                                         | person who dies at t7                                                                                                                                                   |
| `faehrsteg`        | base | ort          | Fährsteg                                                          | place shown as a pin inside Nordhafen                                                                                                                                   |
| `ada`              | base | person       | Ada                                                               | side character; directed relationship to Bela                                                                                                                           |
| `bela`             | base | person       | Bela                                                              | side character; undirected relationship to Ada                                                                                                                          |
| `x-cluster-1`      | edge | ort          | Ostkai                                                            | one of eight places stacked on one point (T-129)                                                                                                                        |
| `x-cluster-2`      | edge | ort          | Ostmole                                                           | one of eight places stacked on one point (T-129)                                                                                                                        |
| `x-cluster-3`      | edge | ort          | Ostspeicher                                                       | one of eight places stacked on one point (T-129)                                                                                                                        |
| `x-cluster-4`      | edge | ort          | Ostwache                                                          | one of eight places stacked on one point (T-129)                                                                                                                        |
| `x-cluster-5`      | edge | ort          | Ostbrücke                                                         | one of eight places stacked on one point (T-129); the favourite                                                                                                         |
| `x-cluster-6`      | edge | ort          | Osttor                                                            | one of eight places stacked on one point (T-129)                                                                                                                        |
| `x-cluster-7`      | edge | ort          | Ostfeuer                                                          | one of eight places stacked on one point (T-129)                                                                                                                        |
| `x-cluster-8`      | edge | ort          | Ostmarkt                                                          | one of eight places stacked on one point (T-129)                                                                                                                        |
| `x-long-name`      | edge | person       | Hafenmeistereiangestelltenvertretungsvorsitzendenstellvertreterin | person whose name is one unbreakable word of 65 letters (T-129, T-183)                                                                                                  |
| `x-long-place`     | edge | ort          | Speicherviertel hinter der alten Fischhalle am nördlichen Kai     | long place name inside Nordhafen (cut as North Harb... in T-173 B)                                                                                                      |
| `x-long-org`       | edge | organisation | Vereinigte Gilde der Kartographen, Lotsen und Leuchtturmwärter    | long organisation name with an apostrophe (cut in T-173 B)                                                                                                              |
| `x-empty-note`     | edge | objekt       | Leerer Kompass                                                    | element with an empty note                                                                                                                                              |
| `x-weltkarte`      | edge | ort          | Weltkarte                                                         | map opened out on the world level, 1000 x 680 with a 25 km scale; mocked alone by the map specs                                                                         |
| `x-graufurth`      | edge | ort          | Graufurth                                                         | place standing on the opened-out map, the one the map specs select                                                                                                      |
| `x-nordhafen`      | edge | ort          | Nordhafen                                                         | place standing on the opened-out map, 200 km from Graufurth; shares its name with the city, so it keeps no children: element-notes opens the city by 'Nordhafen öffnen' |
| `x-tannenhain`     | edge | ort          | Tannenhain                                                        | place standing on the opened-out map near its lower edge                                                                                                                |
| `x-inselkarte`     | edge | ort          | Inselkarte                                                        | second opened-out map, 600 x 500, overlapping the first; the map specs add it on demand                                                                                 |
| `x-inselhafen`     | edge | ort          | Inselhafen                                                        | the one place on the second map                                                                                                                                         |
| `x-masslos-ebene`  | edge | ort          | Kartenarchiv                                                      | level of its own for the map without a size (T-79)                                                                                                                      |
| `x-masslose-karte` | edge | ort          | Alte Hafenkarte                                                   | opened-out map with a picture but no frame size; the server fills it in (T-79)                                                                                          |

## Chapters

| Id                | Part | Where   | Title                        | Purpose                                                                                                   |
| ----------------- | ---- | ------- | ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `c-arrival`       | base | act-one | Die Ankunft                  |                                                                                                           |
| `c-archive`       | base | act-one | Das Archiv                   |                                                                                                           |
| `c-sheet`         | base | act-one | Das letzte Blatt             |                                                                                                           |
| `c-market`        | base | act-one | Gerüchte am Salzmarkt        |                                                                                                           |
| `c-storm`         | base | act-two | Vor dem Sturm                |                                                                                                           |
| `c-break`         | base | act-two | Bruch mit der Gilde          |                                                                                                           |
| `c-crossing`      | base | act-two | Die Überfahrt                |                                                                                                           |
| `c-coast`         | base | act-two | Die offene Küste             |                                                                                                           |
| `x-empty-chapter` | edge | act-two | Leeres Kapitel               | chapter without text and without a note                                                                   |
| `x-chronicle`     | edge | act-two | Die Chronik des Hafens       | chapter with three texts; seedExampleWorldWithHistory saves them as versions, the first creates it (T-86) |
| `c-prologue`      | base | bin     | Prolog: Was der Atlas wusste |                                                                                                           |
| `x-trash-orphan`  | edge | bin     | Verworfener Entwurf          | chapter in the bin whose folder no longer exists                                                          |

## Moments

| Id   | Time | Title                   |
| ---- | ---- | ----------------------- |
| `t1` | 0    | Ankunft im Nordhafen    |
| `t2` | 3    | Öffnung des Atlas       |
| `t3` | 6    | Das letzte Blatt        |
| `t4` | 9    | Gerüchte am Salzmarkt   |
| `t5` | 12   | Der Hafen wird gesperrt |
| `t6` | 15   | Bruch mit der Gilde     |
| `t7` | 18   | Die Überfahrt           |
| `t8` | 22   | Die offene Küste        |

## Storyboards

| Id                  | Part | Board           | Kind       | Label or target              | Purpose                                                                      |
| ------------------- | ---- | --------------- | ---------- | ---------------------------- | ---------------------------------------------------------------------------- |
| `main-storyboard`   | base |                 | board      | Der Weg durch den Nebel      |                                                                              |
| `second-board`      | base |                 | board      | Die Überfahrt                |                                                                              |
| `x-board`           | edge |                 | board      | Prüfteil                     | board holding every card of the check part                                   |
| `x-layers`          | edge |                 | board      | Ebenen                       | board holding only the two overlapping notes                                 |
| `group-act-one`     | base | main-storyboard | group      | I · Nordhafen                |                                                                              |
| `group-act-two`     | base | main-storyboard | group      | II · Kartennebel             |                                                                              |
| `note-arrival`      | base | main-storyboard | note       | Ankunft & erste Spur         |                                                                              |
| `reference-mara`    | base | main-storyboard | reference  | entity:mara                  |                                                                              |
| `note-rumour`       | base | main-storyboard | note       | Gerüchte                     |                                                                              |
| `reference-archive` | base | main-storyboard | reference  | place:archive                |                                                                              |
| `note-turn`         | base | main-storyboard | note       | Wendepunkt                   |                                                                              |
| `reference-chapter` | base | main-storyboard | reference  | chapter:c-storm              |                                                                              |
| `board-crossing`    | base | main-storyboard | storyboard | storyboard:second-board      |                                                                              |
| `note-sea`          | base | second-board    | note       | Jenseits der bekannten Küste |                                                                              |
| `reference-atlas`   | base | second-board    | reference  | entity:atlas                 |                                                                              |
| `note-crossing`     | base | second-board    | note       | Die Laterne                  |                                                                              |
| `reference-tilo`    | base | second-board    | reference  | entity:tilo                  |                                                                              |
| `board-north`       | base | second-board    | storyboard | storyboard:main-storyboard   |                                                                              |
| `x-ref-deleted`     | edge | x-board         | reference  | entity:x-gone                | reference card to an element that does not exist (T-177)                     |
| `x-ref-trashed`     | edge | x-board         | reference  | chapter:c-prologue           | reference card to a chapter in the bin (T-177)                               |
| `x-ref-storm-again` | edge | x-board         | reference  | chapter:c-storm              | second card on the chapter the main board shows; one note, two cards (T-177) |
| `x-ref-ada`         | edge | x-board         | reference  | entity:ada                   | card on a side character, listed as a backlink in the figure inspector       |
| `x-layer-back`      | edge | x-layers        | note       | Hintere Karte                | note overlapped by x-layer-front, one layer below it                         |
| `x-layer-front`     | edge | x-layers        | note       | Vordere Karte                | note overlapping x-layer-back, one layer above it                            |
