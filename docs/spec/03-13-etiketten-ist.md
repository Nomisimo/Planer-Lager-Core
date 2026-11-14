## 3.13 Etiketten [IST]
 • EtikettenVorlage: name, breite_mm, hoehe_mm, farbe, standard, Elemente (frei platzierbar, mm-genau,
   drehbar) vom Typ qr, code, name, kategorie, logo, firma, farbe (Länge auf Farbfeld), text, barcode (Code
   128).
 • EtikettBestellung: nummer (EB-JJJJ-NNN), lieferant (Standard „Stromstoss"), notiz, erstellt,
   bestellt_am; Status abgeleitet: offen, teilweise, geliefert.

  • EtikettCode: bestellung, artikel, code (eindeutig), geraet (OneToOne, gesetzt nach Lieferung),
   geliefert_am.
