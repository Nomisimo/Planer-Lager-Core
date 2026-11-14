# Anhang A: Dateikarte der Referenz-Implementierung
Thema                              Datei
Datenmodell                        core/models.py
Rechte und Rollen                  core/rechte.py, core/middleware.py
Scan-Logik                         core/services.py
Packliste, Sets, Abgleich          core/packliste.py
Verfügbarkeit                      core/verfuegbarkeit.py
Ladezonen                          core/zonen.py, core/views_zonen.py
Arbeitsplätze                      core/station.py, core/views_station.py, core/views_stationen.py
Packen/Rückgabe/Verladen           core/views_packen.py, core/views_material.py (Scan-API)
Material/Geräte                    core/views_material.py, core/forms.py
Kabel                              core/kabel.py, core/views_kabel.py
Barcode/QR                         core/barcode.py, core/services.py::qr_svg
Etiketten                          core/views_etiketten.py, core/etiketten_layout.py,
                                   core/etiketten_bestellung.py, core/views_bestellung.py
Projekte/Jobs                      core/views.py, core/views_jobs.py, core/uebersicht.py
Dateien                            core/views_projektdateien.py
Planungszeit                       core/zeit.py, core/views_zeit.py
Angebote                           core/views_angebot.py, core/pdf.py
Kalender, Suche                    core/views_kalender.py, core/views_suche.py
Sicherheit                         core/sicherheit.py, core/views_sicherheit.py
Backup                             core/backup.py, core/views_backup.py
Menü                               core/context.py
URL-Plan                           core/urls.py
Tests                              core/tests.py
