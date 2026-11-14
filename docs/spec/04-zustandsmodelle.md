# 4. Zustandsmodelle
4.1 Projekt/Job
 Anfrage -> Angebot gesendet -> Bestätigt -> Läuft -> Abgeschlossen
    \_________________\______________\_________\-> Storniert

 • R-12 Statuswechsel setzt die Benutzerin im Projekt (Bereich projekte w). Rückwärts ist erlaubt (Korrektur).
 • R-13 Wechsel auf abgeschlossen oder storniert gibt die Ladezone sofort frei (ladezone=None).
 • R-14 Beim Verladen (Packen abgeschlossen) wechselt bestaetigt automatisch auf laeuft.
 • R-15 Material-Reservierung: siehe R-24 (hängt vom Angebotsstatus und vom Projektstatus ab).

4.2 Angebot
Entwurf -> Versendet -> Angenommen oder Abgelehnt/verworfen.

 • Entwurf und Abgelehnt reservieren nichts. Versendet = vorgemerkt bis gueltig_bis. Angenommen = fest
   reserviert, solange das Projekt nicht abgeschlossen/storniert ist.
 • Jede Versendung erzeugt eine neue Fassung; die vorherige wird mit PDF archiviert (AngebotFassung).

4.3 Gerät
 Im Lager <-> Projekt zugeordnet <-> Gepackt        (Packen/Rückgabe)
 Im Lager/Zugeordnet/Gepackt -> Vermisst -> Im Lager (gefunden)
 beliebig -> Defekt / in Reparatur -> Im Lager       (nach Reparatur und Prüfung)
 beliebig -> Ausgemustert | Verkauft                 (endgültig, nicht löschen)

 • R-16 gesperrt = Status Vermisst, Defekt, Ausgemustert oder Verkauft. Gesperrte Geräte können nicht
   gepackt werden.
 • R-17 Einsatzfähig (für Verfügbarkeit) = Im Lager, Zugeordnet, Gepackt.
 • R-18 Statuswechsel erzeugt immer einen Bewegung-Eintrag mit Aktion, Person, Zeit.
 • R-19 [IST] Ein Gerät lässt sich nicht löschen, solange es einem Projekt zugeordnet ist (Ausnahme: vermisst
   oder ausgemustert). Beim Löschen wird der Verlauf mitgelöscht, der Code nie neu vergeben; die Oberfläche
   empfiehlt „Ausmustern". [SOLL P2] Geräte mit Bewegungsverlauf dürfen gar nicht mehr gelöscht werden,
   nur ausgemustert (Nachweis).

4.4 Etikett-Bestellung
offen (kein Code geliefert) -> teilweise -> geliefert (alle Codes geliefert).

 • Löschen nur, solange noch kein Gerät aus der Bestellung gebucht wurde.
