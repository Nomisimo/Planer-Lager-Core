-- Phase 8: Lager-Arbeitsplätze und Mitarbeiter (Spec 2.4, R-11a–g, FA-25). Anzeige-Bildschirme sind Arbeitsplätze der Art „anzeige“.
CREATE TABLE mitarbeiter (
  id serial PRIMARY KEY,
  name text NOT NULL CHECK (btrim(name) <> ''),
  pin_hash text NOT NULL DEFAULT '',
  aktiv boolean NOT NULL DEFAULT true,
  erstellt timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX mitarbeiter_name_uk ON mitarbeiter (lower(name));

CREATE TABLE arbeitsplatz (
  id serial PRIMARY KEY,
  name text NOT NULL CHECK (btrim(name) <> ''),
  art text NOT NULL DEFAULT 'packen' CHECK (art IN ('packen', 'rueckgabe', 'anzeige')),
  ladezone_id int REFERENCES ladezone(id) ON DELETE SET NULL,
  benutzer_id int UNIQUE REFERENCES benutzer(id) ON DELETE SET NULL,
  sperrzeit_minuten int NOT NULL DEFAULT 10 CHECK (sperrzeit_minuten BETWEEN 1 AND 480),
  funktionstest boolean NOT NULL DEFAULT false,
  aktiv boolean NOT NULL DEFAULT true,
  einrichtung_hash text NOT NULL DEFAULT '',
  einrichtung_bis timestamptz,
  mitarbeiter_id int REFERENCES mitarbeiter(id) ON DELETE SET NULL,
  letzte_aktivitaet timestamptz,
  fehlversuche int NOT NULL DEFAULT 0,
  gesperrt_bis timestamptz,
  letzter_kontakt timestamptz,
  erstellt timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX arbeitsplatz_name_uk ON arbeitsplatz (lower(name));

-- Geräte-Sitzung: langlebig (Arbeitsplatz/Anzeige bleibt wochenlang angemeldet, R-59)
ALTER TABLE sitzung DROP CONSTRAINT IF EXISTS sitzung_art_check;
ALTER TABLE sitzung ADD CONSTRAINT sitzung_art_check CHECK (art IN ('app', 'web', 'zwischen', 'geraet'));

-- Netzwerk-Scanner → Arbeitsplatz (aus Phase 6)
UPDATE scanner SET arbeitsplatz_id = NULL WHERE arbeitsplatz_id IS NOT NULL AND arbeitsplatz_id NOT IN (SELECT id FROM arbeitsplatz);
ALTER TABLE scanner ADD CONSTRAINT scanner_arbeitsplatz_fk FOREIGN KEY (arbeitsplatz_id) REFERENCES arbeitsplatz(id) ON DELETE SET NULL;
