-- FA-28 Mehrere Ansprechpartner je Kunde, Kundenhistorie (Kommunikation, Notizen mit Zeit/Person).
-- Beide sind Unterteile des Kunden (Kaskade beim Löschen); beim Anonymisieren werden sie gelöscht (NFA-03).
CREATE TABLE kunde_kontakt (
  id serial PRIMARY KEY,
  kunde_id int NOT NULL REFERENCES kunde(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> ''),
  funktion text NOT NULL DEFAULT '',
  telefon text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  notiz text NOT NULL DEFAULT '',
  haupt boolean NOT NULL DEFAULT false
);
CREATE INDEX kunde_kontakt_kunde ON kunde_kontakt (kunde_id);
CREATE UNIQUE INDEX kunde_kontakt_ein_haupt ON kunde_kontakt (kunde_id) WHERE haupt;

CREATE TABLE kunde_historie (
  id serial PRIMARY KEY,
  kunde_id int NOT NULL REFERENCES kunde(id) ON DELETE CASCADE,
  art text NOT NULL DEFAULT 'notiz' CHECK (art IN ('notiz', 'telefon', 'email', 'treffen')),
  text text NOT NULL CHECK (btrim(text) <> ''),
  kontakt_id int REFERENCES kunde_kontakt(id) ON DELETE SET NULL,
  zeit timestamptz NOT NULL DEFAULT now(),
  von text NOT NULL DEFAULT '',
  von_id int REFERENCES benutzer(id) ON DELETE SET NULL
);
CREATE INDEX kunde_historie_kunde ON kunde_historie (kunde_id, zeit DESC);
