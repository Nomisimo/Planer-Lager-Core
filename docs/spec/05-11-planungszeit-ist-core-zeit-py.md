## 5.11 Planungszeit [IST] (core/zeit.py)
 • R-62 Erfasst wird nur Planungszeit an einem Projekt. Packen, Rückgabe und Arbeit vor Ort werden hier
   nicht erfasst (die Seiten /projekte/<id>/packen|rueckgabe|status|zone|verladen|anzeige gelten nicht
   als Planungskontext).
 • R-63 Der Timer läuft nur, wenn bewusst ein Projekt gewählt wurde. Er stoppt, sobald der Benutzer eine Seite
   eines anderen Projekts oder eine Nicht-Planungsseite öffnet, und nach 300 Sekunden ohne Aktivität
   (Endzeit = letzte Aktivität). Neutrale Seiten (Zeiterfassung, Material, Suche, Kalender, Design) unterbrechen
   nicht. Ein regelmäßiger Herzschlag-Aufruf der Seite (/zeiterfassung/ping/) hält den Timer am Leben.
 • R-64 Pro Benutzer läuft höchstens ein Timer.
 • R-65 Nachbuchen von Hand ist möglich (Quelle manuell).
 • R-66 Satz: Stundensatz des Postens „Technische Projektleitung" (Tagessatz ÷ tag_stunden_standard, bzw.
   Preis, wenn der Posten je Stunde gilt; sonst Ersatz-Stundensatz) × Prozentsatz (Planung 30 %). Beim
   Stoppen wird die Zeit als Position in einem Rechnungsentwurf vorgemerkt. Sie wird nie automatisch
   fertiggestellt (Schnittstelle Kap. 11).
