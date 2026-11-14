## 3.2 Projekt und Job [IST] (Projekt)
Feld                                                         Beschreibung
nummer                                                       eindeutig, automatisch: P-JJJJ-NNN (Projekt) oder J-JJJJ-NNN
                                                             (Job), NNN fortlaufend je Jahr und Art
art                                                          projekt oder job
uebergeordnet                                                nur Jobs: Projekt, zu dem der Job gehört. PROTECT, genau eine
                                                             Ebene
gewerk                                                       nur Jobs: Ton, Licht, Video, Rigging/Traversen, Strom,
                                                             Bühne/Aufbau, Transport/Logistik, Sonstiges
name, kunde (PROTECT), status, beginn, ende, ort,
notizen
ordner                                                       Projektordner (automatisch) mit Unterordnern Angebote,
                                                             Rechnungen, Dokumente. Jobs liegen unter
                                                             <Projektordner>/Jobs/
ladezone (SET_NULL), zone_seit                               zugewiesene Ladezone
gepackt_am, gepackt_von (Mitarbeiter),                       Packabschluss; der Name bleibt auch bei gelöschtem Mitarbeiter
gepackt_von_name                                             erhalten
