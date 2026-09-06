"""Wie lange ein Test auf eine Antwort des eingebauten Servers wartet.

Fünf Sekunden waren zu knapp. Auf einem ausgelasteten Windows-Runner hat das Anlegen
einer Welt -- SQLite-Datei, Verzeichnisse, Synchronisieren auf die Platte -- länger
gebraucht, und der Test fiel mit einem Socket-Timeout, obwohl nichts hängen geblieben
war. Danach liess sich das Temp-Verzeichnis nicht mehr räumen, weil der Server die Datei
noch offen hielt: aus einem langsamen Lauf wurden zwei Fehler.

Zwanzig Sekunden nehmen einem echten Hänger nicht die Chance, aufzufallen -- der Lauf
bricht weiterhin ab, statt zu warten, bis der Job seine Zeit verbraucht hat. Sie stehen
hier an einer Stelle, damit nicht jede Suite ihre eigene Geduld erfindet; zwanzig war
schon vorher das Mass in ``test_backup_routes``, das als einziges nie an dieser Grenze
gescheitert ist.
"""

REQUEST_TIMEOUT = 20
