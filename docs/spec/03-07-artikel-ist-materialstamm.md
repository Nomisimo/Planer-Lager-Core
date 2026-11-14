## 3.7 Artikel [IST] (Materialstamm)
Feld                                                      Beschreibung
name, kategorie (PROTECT), hersteller,                    Stammdaten
beschreibung, aktiv
preis_tag                                                 Mietpreis pro Stück und Tag; folgetag_prozent Preis der
                                                          Folgetage in %
verkaeuflich, verkaufspreis                               auch zum Verkauf
mengenschritt                                             Vermietung nur in Sets zu n Stück (z. B. 4er-Set Lampen)
ist_case, inhalt_artikel, verpackungseinheit              Case/Tasche: enthält soll_inhalt Teile (aus
                                                          inhalt_artikel.mengenschritt, sonst
                                                          verpackungseinheit)
ist_leistung, zeitmodell, preis_erweitert                 Dienstleistung (Personal, Pauschale), Tagessatz mit
                                                          Überstundenregel
verbrauch, bestand, mindestbestand, einheit               Verbrauchsmaterial (nur Menge, keine Einzelgeräte)
pruefpflichtig, pruef_intervall_monate                    Prüfpflicht (Standard: ja, 12 Monate)
plansymbol                                                Piktogramm für yEd-Symbolbibliothek
laenge_m, farbcode                                        Kabel: Länge in m und automatisch vergebene Farbe

Artikeltyp ergibt sich aus den Kennzeichen (Reihenfolge der Anzeige): Dienstleistung, Case, Verbrauch, nur
n-er-Set, Artikel.
