-- FA-39 Projektvorlagen: Standardaufgaben und Standardpositionen je Art von Veranstaltung.
CREATE TABLE projekt_vorlage (
  id serial PRIMARY KEY,
  name text NOT NULL CHECK (btrim(name) <> ''),
  veranstaltung text NOT NULL DEFAULT '',
  beschreibung text NOT NULL DEFAULT '',
  aufgaben jsonb NOT NULL DEFAULT '[]',     -- [{text, tage_vorher|null, zugewiesen_id|null}]
  positionen jsonb NOT NULL DEFAULT '[]',   -- [{artikel_id, menge}]
  aktiv boolean NOT NULL DEFAULT true,
  erstellt_von text NOT NULL DEFAULT '',
  erstellt timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX projekt_vorlage_name ON projekt_vorlage (lower(name));

-- FA-40 Wiederkehrende Aufgaben: Regel erzeugt Aufgaben (mit oder ohne Projekt).
ALTER TABLE aufgabe ALTER COLUMN projekt_id DROP NOT NULL;
CREATE TABLE aufgabe_regel (
  id serial PRIMARY KEY,
  text text NOT NULL CHECK (btrim(text) <> ''),
  projekt_id int REFERENCES projekt(id) ON DELETE CASCADE,
  zugewiesen_id int REFERENCES benutzer(id) ON DELETE SET NULL,
  rhythmus text NOT NULL CHECK (rhythmus IN ('taeglich', 'woechentlich', 'monatlich', 'jaehrlich')),
  alle int NOT NULL DEFAULT 1 CHECK (alle BETWEEN 1 AND 365),
  naechste date NOT NULL,
  vorlauf_tage int NOT NULL DEFAULT 0 CHECK (vorlauf_tage BETWEEN 0 AND 365),
  aktiv boolean NOT NULL DEFAULT true,
  von text NOT NULL DEFAULT '',
  erstellt timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE aufgabe ADD COLUMN regel_id int REFERENCES aufgabe_regel(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX aufgabe_regel_termin ON aufgabe (regel_id, faellig) WHERE regel_id IS NOT NULL;

-- FA-40 Benachrichtigungen (E-5: In-App + E-Mail per SMTP): Fristen, Prüfungen, Überbuchung.
CREATE TABLE benachrichtigung (
  id bigserial PRIMARY KEY,
  benutzer_id int NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  art text NOT NULL CHECK (art IN ('frist', 'pruefung', 'ueberbuchung', 'wartung')),
  schluessel text NOT NULL,                 -- verhindert Doppelte (z. B. frist-12-2027-05-01)
  titel text NOT NULL,
  text text NOT NULL DEFAULT '',
  app text NOT NULL DEFAULT 'p' CHECK (app IN ('m', 'p')),
  pfad text NOT NULL DEFAULT '',
  erstellt timestamptz NOT NULL DEFAULT now(),
  gelesen timestamptz,
  mail_status text NOT NULL DEFAULT '' CHECK (mail_status IN ('', 'offen', 'gesendet', 'fehler')),
  UNIQUE (benutzer_id, schluessel)
);
CREATE INDEX benachrichtigung_offen ON benachrichtigung (benutzer_id, erstellt DESC) WHERE gelesen IS NULL;
ALTER TABLE benutzer ADD COLUMN mail_benachrichtigung boolean NOT NULL DEFAULT true;
