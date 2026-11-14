## 5.8 Ladezonen [IST] (core/zonen.py)
 • R-55 Priorität „Als Nächstes zu packen": Projekte mit Status Bestätigt oder Läuft, noch nicht als gepackt
   abgeschlossen, sortiert nach beginn (ohne Beginn zuletzt), dann Anlegedatum, dann Nummer.
 • R-56 Zuweisen: nicht für abgeschlossene/stornierte Projekte; Zone muss aktiv sein; ist das Projekt schon in
   der Zone, nichts tun; ist die Zone voll -> Fehler „Die Ladezone ... ist voll (n von n Plätzen belegt)." Setzt
   zone_seit.
 • R-57 Freigeben: ladezone und zone_seit leeren (auch automatisch bei Verladen, Abschluss, Storno).
 • R-58 Automatische Verteilung (Einstellung zonen_auto, beim Anmelden, nicht bei Anzeige-Bildschirmen;
   oder per Knopf): Projekte in Prioritätsreihenfolge ohne Zone auf die nächste freie aktive Zone verteilen, bis
   keine frei ist. Ein Fehler darf eine Anmeldung nie verhindern.
 • R-59 Anzeige-Bildschirm: Vollbildseite je Zone mit QR-Code des Projekts, aktualisiert sich selbst, bleibt
   wochenlang angemeldet.
