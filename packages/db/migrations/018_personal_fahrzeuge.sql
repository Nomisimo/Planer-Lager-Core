-- FA-37 Ressourcenplanung Personal, FA-38 Transport/Fahrzeuge.
CREATE TABLE personal (
  id serial PRIMARY KEY,
  name text NOT NULL CHECK (btrim(name) <> ''),
  art text NOT NULL DEFAULT 'mitarbeiter' CHECK (art IN ('mitarbeiter', 'freelancer')),
  qualifikationen text[] NOT NULL DEFAULT '{}',
  telefon text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  tagessatz int CHECK (tagessatz >= 0),          -- Cent, für Freelancer
  aktiv boolean NOT NULL DEFAULT true,
  notizen text NOT NULL DEFAULT '',
  version int NOT NULL DEFAULT 1,
  erstellt timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX personal_name_uk ON personal (lower(name));

-- Verfügbarkeit: Abwesenheiten (Urlaub, krank, anderweitig gebucht)
CREATE TABLE personal_abwesenheit (
  id serial PRIMARY KEY,
  personal_id int NOT NULL REFERENCES personal(id) ON DELETE CASCADE,
  von date NOT NULL,
  bis date NOT NULL,
  grund text NOT NULL DEFAULT '',
  CHECK (bis >= von)
);
CREATE INDEX personal_abwesenheit_ix ON personal_abwesenheit (personal_id, von, bis);

CREATE TABLE einsatz (
  id serial PRIMARY KEY,
  personal_id int NOT NULL REFERENCES personal(id) ON DELETE RESTRICT,
  projekt_id int NOT NULL REFERENCES projekt(id) ON DELETE RESTRICT,
  beginn timestamptz NOT NULL,
  ende timestamptz NOT NULL,
  rolle text NOT NULL DEFAULT '',
  angebot_position_id int REFERENCES angebot_position(id) ON DELETE SET NULL,
  notiz text NOT NULL DEFAULT '',
  konflikt_bestaetigt boolean NOT NULL DEFAULT false,
  erstellt_von text NOT NULL DEFAULT '',
  CHECK (ende > beginn)
);
CREATE INDEX einsatz_personal_ix ON einsatz (personal_id, beginn, ende);
CREATE INDEX einsatz_projekt_ix ON einsatz (projekt_id);

CREATE TABLE fahrzeug (
  id serial PRIMARY KEY,
  name text NOT NULL CHECK (btrim(name) <> ''),
  kennzeichen text NOT NULL DEFAULT '',
  zuladung_kg int CHECK (zuladung_kg > 0),
  ladevolumen_m3 numeric(6,2) CHECK (ladevolumen_m3 > 0),
  aktiv boolean NOT NULL DEFAULT true,
  notizen text NOT NULL DEFAULT '',
  version int NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX fahrzeug_name_uk ON fahrzeug (lower(name));

CREATE TABLE fahrt (
  id serial PRIMARY KEY,
  fahrzeug_id int NOT NULL REFERENCES fahrzeug(id) ON DELETE RESTRICT,
  projekt_id int NOT NULL REFERENCES projekt(id) ON DELETE RESTRICT,
  abholung timestamptz NOT NULL,
  rueckkehr timestamptz NOT NULL,
  ziel text NOT NULL DEFAULT '',
  fahrer_id int REFERENCES personal(id) ON DELETE SET NULL,
  notiz text NOT NULL DEFAULT '',
  konflikt_bestaetigt boolean NOT NULL DEFAULT false,
  CHECK (rueckkehr > abholung)
);
CREATE INDEX fahrt_fahrzeug_ix ON fahrt (fahrzeug_id, abholung, rueckkehr);
CREATE INDEX fahrt_projekt_ix ON fahrt (projekt_id);

-- Ladeliste je Fahrzeug: Teil der Packliste (Artikel + Menge) auf eine Fahrt
CREATE TABLE fahrt_ladung (
  fahrt_id int NOT NULL REFERENCES fahrt(id) ON DELETE CASCADE,
  artikel_id int NOT NULL REFERENCES artikel(id) ON DELETE RESTRICT,
  menge numeric(10,2) NOT NULL CHECK (menge > 0),
  PRIMARY KEY (fahrt_id, artikel_id)
);

ALTER TABLE artikel ADD COLUMN gewicht_kg numeric(8,2) CHECK (gewicht_kg >= 0);
