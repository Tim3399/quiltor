#!/usr/bin/env python3
"""Create or refresh the persistent local world used for assistant evaluation."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend import storage

TITLE = "Quiltor AI Testwelt"

MANUSCRIPT = {"chapters": [
    {"id": "tc01", "title": "Das verschwundene Siegel", "body": "Archivarin Mara Venn entdeckt, dass das silberne Staatssiegel aus der verschlossenen Westkammer fehlt. Nur Regent Iven, Hauptmann Corvin und sie selbst besitzen einen Schlüssel. Im Staub liegt roter Lehm aus den Tunneln unter Asterheim.", "note": "Mara verschweigt zunächst, dass ihr Bruder Tarek Zugang zu den Tunneln kennt."},
    {"id": "tc02", "title": "Unter Asterheim", "body": "Tarek führt Mara durch die alten Wasserstollen. Dort treffen sie Schmugglerin Sera Nox, die behauptet, Corvin habe eine versiegelte Kassette gekauft. Ein verletzter Bote trägt das Zeichen des Ordens der Weißen Flamme.", "note": "Sera lügt über den Käufer, um ihre Tochter zu schützen."},
    {"id": "tc03", "title": "Die Krönung", "body": "Während Ivens Krönung erkennt Mara am Ring des Priesters eine Kopie des Staatssiegels. Die Menge gerät in Panik, als ein Bolzen den Thron trifft. Corvin rettet Iven, obwohl er ihn heimlich erpresst.", "note": "Ab hier wird aus Maras Vertrauen gegenüber Corvin offenes Misstrauen. Datum 14.03.1421."},
    {"id": "tc04", "title": "Das Haus ohne Fenster", "body": "Im Ordenshaus findet Mara Listen verschwundener Jugendlicher. Priorin Elian behauptet, die Namen gehörten zu freiwilligen Novizen. Zeugenaussagen sprechen jedoch von Zwang, Gewalt und systematischer Einschüchterung.", "note": "Dunkle Thriller-Themen sachlich analysieren; keine Szene fortschreiben."},
    {"id": "tc05", "title": "Seras Preis", "body": "Sera übergibt Mara die Kassette und verlangt Schutz für ihre Tochter Nima. Darin liegen Briefe, die Ivens verstorbenen Vater mit der Weißen Flamme verbinden. Tarek will die Briefe veröffentlichen, Mara fürchtet einen Bürgerkrieg.", "note": "Konflikt: Wahrheit gegen Stabilität."},
    {"id": "tc06", "title": "Verrat am Nordtor", "body": "Corvin öffnet das Nordtor für Ordensleute, um Ivens Geiselnahme zu erzwingen. Als Nima dazwischen gerät, wendet er sich gegen den Orden. Priorin Elian tötet Corvin und flieht mit dem echten Siegel.", "note": "Corvin stirbt am Ereignis Nordtor; seine Beziehung zu Iven wechselt zuvor von loyal zu erpresserisch."},
    {"id": "tc07", "title": "Der Prozess", "body": "Mara legt die Briefe und Seras Aussage dem Rat vor. Iven gesteht die Verbrechen seines Vaters nicht vertuscht, aber aus Angst verschwiegen zu haben. Elian wird in Abwesenheit angeklagt.", "note": "Iven und Mara werden vorsichtige politische Verbündete."},
    {"id": "tc08", "title": "Asche im Schnee", "body": "Monate später findet Tarek das Siegel in einem ausgebrannten Kloster. Eine Nachricht deutet darauf hin, dass Elian lebt. Mara archiviert den Fall nicht als abgeschlossen, sondern als Beginn eines größeren Netzes.", "note": "Offenes Ende; Ort Frostkloster für spätere Erweiterung anlegen."},
]}

NODES = [
    {"id": "mara", "x": 96, "y": 96, "type": "person", "name": "Mara Venn", "label": "Archivarin", "sub": "Sucht Wahrheit, fürchtet aber ihre politischen Folgen.", "profile": {"alter": "32", "rolle": "Ermittlerin und moralisches Zentrum", "herkunft": "Asterheim", "stimme": "Präzise, kontrolliert", "notizen": "Schwester von Tarek", "extra": []}},
    {"id": "iven", "x": 384, "y": 96, "type": "person", "name": "Iven Arclay", "label": "Regent", "sub": "Erbt Macht und die Schuld seines Vaters.", "profile": {"alter": "27", "rolle": "Politischer Gegenpol", "notizen": "Wird am 14.03.1421 gekrönt", "extra": []}},
    {"id": "corvin", "x": 672, "y": 96, "type": "person", "name": "Corvin Vale", "label": "Hauptmann", "sub": "Loyalität, Erpressung und späte Umkehr.", "diedMomentId": "northgate", "profile": {"alter": "45", "rolle": "Tragischer Verräter", "extra": []}},
    {"id": "tarek", "x": 96, "y": 288, "type": "person", "name": "Tarek Venn", "label": "Kartograf", "sub": "Kennt die Tunnel unter der Stadt.", "profile": {"alter": "29", "rolle": "Radikaler Verfechter von Transparenz", "extra": []}},
    {"id": "sera", "x": 384, "y": 288, "type": "person", "name": "Sera Nox", "label": "Schmugglerin", "sub": "Handelt für den Schutz ihrer Tochter.", "profile": {"rolle": "Informantin mit eigenen Interessen", "extra": []}},
    {"id": "elian", "x": 672, "y": 288, "type": "person", "name": "Priorin Elian", "label": "Antagonistin", "sub": "Leitet den Orden der Weißen Flamme.", "profile": {"rolle": "Ideologische Gegenspielerin", "notizen": "Status nach dem Frostkloster unbekannt", "extra": []}},
    {"id": "nima", "x": 960, "y": 288, "type": "person", "name": "Nima Nox", "label": "Zeugin", "sub": "Seras Tochter; gerät am Nordtor zwischen die Fronten.", "profile": {"alter": "16", "extra": []}},
    {"id": "asterheim", "x": 96, "y": 528, "type": "ort", "name": "Asterheim", "label": "Hauptstadt", "sub": "Palast, Archiv, Tunnel und Nordtor.", "profile": {"extra": []}},
    {"id": "tunnels", "x": 384, "y": 528, "type": "ort", "name": "Wasserstollen", "label": "Unterwelt", "sub": "Alte Tunnel mit rotem Lehm.", "profile": {"extra": []}},
    {"id": "orderhouse", "x": 672, "y": 528, "type": "ort", "name": "Ordenshaus", "label": "Verdecktes Machtzentrum", "sub": "Fensterloses Haus der Weißen Flamme.", "profile": {"extra": []}},
    {"id": "seal", "x": 96, "y": 720, "type": "konzept", "name": "Staatssiegel", "label": "MacGuffin", "sub": "Legitimiert geheime Befehle und politische Macht.", "profile": {"extra": []}},
    {"id": "truth", "x": 384, "y": 720, "type": "konzept", "name": "Wahrheit gegen Stabilität", "label": "Leitkonflikt", "sub": "Welche Wahrheit schuldet man einer fragilen Gesellschaft?", "profile": {"extra": []}},
]

TIMELINE = [
    {"id": "before", "title": "Vor dem Diebstahl", "date": "1421-02-20", "note": "Fragile politische Ruhe."},
    {"id": "theft", "title": "Das Siegel verschwindet", "date": "1421-03-01"},
    {"id": "coronation", "title": "Die Krönung", "date": "1421-03-14"},
    {"id": "letters", "title": "Die Briefe werden gefunden", "date": "1421-03-21"},
    {"id": "northgate", "title": "Verrat am Nordtor", "date": "1421-04-02", "note": "Corvin stirbt; Elian flieht."},
    {"id": "trial", "title": "Der Prozess", "date": "1421-04-18"},
]

EDGES = [
    {"id": "e-mara-tarek", "from": "mara", "to": "tarek", "label": "Geschwister", "gerichtet": False},
    {"id": "e-sera-nima", "from": "sera", "to": "nima", "label": "Mutter und Tochter", "gerichtet": False},
    {"id": "e-mara-iven", "from": "mara", "to": "iven", "label": "Distanziertes Vertrauen", "gerichtet": False, "versions": [{"momentId": "coronation", "label": "Misstrauen", "active": True}, {"momentId": "trial", "label": "Vorsichtige Verbündete", "active": True}]},
    {"id": "e-corvin-iven", "from": "corvin", "to": "iven", "label": "Dient", "gerichtet": True, "versions": [{"momentId": "coronation", "label": "Erpresst", "active": True}, {"momentId": "northgate", "label": "Rettet ihn zuletzt", "active": False}]},
    {"id": "e-elian-corvin", "from": "elian", "to": "corvin", "label": "Erpresst", "gerichtet": True, "versions": [{"momentId": "northgate", "label": "Tötet", "active": False}]},
    {"id": "e-elian-order", "from": "elian", "to": "orderhouse", "label": "Leitet", "gerichtet": True},
    {"id": "e-sera-tunnels", "from": "sera", "to": "tunnels", "label": "Nutzt als Schmuggelroute", "gerichtet": True},
    {"id": "e-tarek-tunnels", "from": "tarek", "to": "tunnels", "label": "Kartiert", "gerichtet": True},
    {"id": "e-seal-asterheim", "from": "seal", "to": "asterheim", "label": "Legitimiert Herrschaft", "gerichtet": True},
    {"id": "e-mara-truth", "from": "mara", "to": "truth", "label": "Ring mit Verantwortung", "gerichtet": True},
    {"id": "e-iven-truth", "from": "iven", "to": "truth", "label": "Fürchtet Instabilität", "gerichtet": True},
    {"id": "e-mara-sera", "from": "mara", "to": "sera", "label": "Misstrauische Informantin", "gerichtet": False, "versions": [{"momentId": "letters", "label": "Zweckbündnis", "active": True}]},
]


def main() -> None:
    existing = next((world for world in storage.list_worlds() if world["title"] == TITLE), None)
    world = existing or storage.create_world(TITLE)
    storage.activate_world(world["id"])
    storage.save_manuscript(MANUSCRIPT)
    storage.save_figures({"nodes": NODES, "edges": EDGES, "timeline": TIMELINE, "canvasSize": {"w": 1800, "h": 1200}})
    print(world["id"])


if __name__ == "__main__":
    main()
