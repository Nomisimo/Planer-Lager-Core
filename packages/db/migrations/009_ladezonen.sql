-- Phase 8: Ladezonen (Spec 3.10, 5.8).
CREATE TABLE ladezone (
  id serial PRIMARY KEY,
  bezeichnung text NOT NULL CHECK (btrim(bezeichnung) <> ''),
  flaeche_m2 numeric(10,2) CHECK (flaeche_m2 IS NULL OR flaeche_m2 >= 0),
  plaetze int NOT NULL DEFAULT 1 CHECK (plaetze >= 1),
  beschreibung text NOT NULL DEFAULT '',
  aktiv boolean NOT NULL DEFAULT true,
  reihenfolge int NOT NULL DEFAULT 0,
  erstellt timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ladezone_bezeichnung_uk ON ladezone (lower(bezeichnung));
UPDATE projekt SET ladezone_id = NULL, zone_seit = NULL WHERE ladezone_id IS NOT NULL;
ALTER TABLE projekt ADD CONSTRAINT projekt_ladezone_fk FOREIGN KEY (ladezone_id) REFERENCES ladezone(id) ON DELETE SET NULL;
CREATE INDEX projekt_ladezone_idx ON projekt (ladezone_id) WHERE ladezone_id IS NOT NULL;
