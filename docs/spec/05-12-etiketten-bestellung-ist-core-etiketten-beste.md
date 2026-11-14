## 5.12 Etiketten-Bestellung [IST] (core/etiketten_bestellung.py)
 • R-67 Bestellen: Positionen (Artikel, Menge). Menge > 0, höchstens 500 je Artikel; nicht für Verbrauch oder
   Leistung; Kategorie braucht ein Kürzel. Es werden fortlaufend Codes reserviert (R-21) und
   EtikettCode-Zeilen angelegt. Es entstehen noch keine Geräte.
 • R-68 Liste für den Lieferanten: PDF (Code 128 mit Text darunter, Länge und Farbmarkierung) und CSV
   (Option „ohne Bindestrich" für Lieferanten, die keinen Bindestrich drucken). Druckvorgabe aus
   etiketten_hinweis.
 • R-69 Liefern: Gelieferte Codes werden gescannt oder abgehakt; je Code entsteht Geraet(code=...,
   artikel=...), geliefert_am wird gesetzt. Zuordnung ignoriert Groß-/Kleinschreibung und Bindestrich.
 • R-70 Scannt jemand einen bestellten, noch nicht gelieferten Code, meldet das System die Bestellnummer
   (R-Scan Schritt 2).
