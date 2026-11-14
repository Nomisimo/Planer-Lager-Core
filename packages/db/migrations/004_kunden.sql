-- Kunde (3.1). Projekte verweisen später mit RESTRICT (PROTECT) auf den Kunden.
CREATE TABLE kunde (
  id serial PRIMARY KEY,
  name text NOT NULL CHECK (btrim(name) <> ''),   -- Ansprechpartner, Pflicht
  firma text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  telefon text NOT NULL DEFAULT '',
  strasse text NOT NULL DEFAULT '',
  plz text NOT NULL DEFAULT '',
  ort text NOT NULL DEFAULT '',
  ust_id text NOT NULL DEFAULT '',
  notizen text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  erstellt timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kunde_name_ix ON kunde (lower(name));
CREATE INDEX kunde_firma_ix ON kunde (lower(firma));
CREATE INDEX kunde_email_ix ON kunde (lower(email)) WHERE email <> '';
