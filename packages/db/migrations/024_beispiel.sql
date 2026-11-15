-- Demo-Daten (ZUSATZ.md Phase 17): welche Zeilen zu den Beispieldaten gehören (`npm run seed -- --seed demo`).
-- Ein Admin kann sie in Verwaltung › System gesammelt löschen.
CREATE TABLE beispiel (
  tabelle text NOT NULL,
  datensatz_id int NOT NULL,
  PRIMARY KEY (tabelle, datensatz_id)
);
