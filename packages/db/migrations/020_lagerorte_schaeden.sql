-- FA-08 Lagerorte/Regalplätze je Artikel oder Gerät (Anzeige beim Packen).
CREATE TABLE lagerort (
  id serial PRIMARY KEY,
  name text NOT NULL CHECK (btrim(name) <> ''),
  bereich text NOT NULL DEFAULT '',
  notiz text NOT NULL DEFAULT '',
  aktiv boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX lagerort_name ON lagerort (lower(name));
ALTER TABLE artikel ADD COLUMN lagerort_id int REFERENCES lagerort(id) ON DELETE RESTRICT;
-- Gerät: eigener Platz, wenn abweichend vom Artikel (leer = Platz des Artikels)
ALTER TABLE geraet ADD COLUMN lagerort_id int REFERENCES lagerort(id) ON DELETE RESTRICT;

-- FA-09 Schadensdokumentation bei Rückgabe mit Fotos, verknüpft mit Projekt und Kunde (Haftung).
CREATE TABLE schaden (
  id serial PRIMARY KEY,
  geraet_id int NOT NULL REFERENCES geraet(id) ON DELETE RESTRICT,
  projekt_id int NOT NULL REFERENCES projekt(id) ON DELETE RESTRICT,
  kunde_id int NOT NULL REFERENCES kunde(id) ON DELETE RESTRICT,
  beschreibung text NOT NULL CHECK (btrim(beschreibung) <> ''),
  fotos text[] NOT NULL DEFAULT '{}',
  reparatur_id int REFERENCES reparatur(id) ON DELETE SET NULL,
  von text NOT NULL DEFAULT '',
  zeit timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX schaden_projekt ON schaden (projekt_id);
CREATE INDEX schaden_kunde ON schaden (kunde_id);
CREATE INDEX schaden_geraet ON schaden (geraet_id);
