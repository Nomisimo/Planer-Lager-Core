-- Phase 9: Planungszeit (Spec 3.5, R-62–R-66) und Schnittstelle Rechnungsentwurf (Kap. 11, Buchhaltung selbst nicht Teil dieses Auftrags).
CREATE TABLE rechnung (
  id serial PRIMARY KEY,
  projekt_id int NOT NULL REFERENCES projekt(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf', 'fertig', 'storniert')),  -- „fertig“ setzt nur die Buchhaltung, nie automatisch (Kap. 11)
  erstellt timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rechnung_projekt_ix ON rechnung (projekt_id);
CREATE UNIQUE INDEX rechnung_ein_entwurf_uk ON rechnung (projekt_id) WHERE status = 'entwurf';

CREATE TABLE zeiteintrag (
  id serial PRIMARY KEY,
  projekt_id int NOT NULL REFERENCES projekt(id) ON DELETE RESTRICT,
  benutzer_id int REFERENCES benutzer(id) ON DELETE SET NULL,
  wer text NOT NULL DEFAULT '',
  datum date NOT NULL DEFAULT (now() AT TIME ZONE 'Europe/Berlin')::date,
  minuten int NOT NULL DEFAULT 0 CHECK (minuten >= 0),
  beschreibung text NOT NULL DEFAULT '',
  laeuft_seit timestamptz,
  zuletzt_aktiv timestamptz,
  quelle text NOT NULL DEFAULT 'timer' CHECK (quelle IN ('timer', 'manuell')),
  satz_basis int NOT NULL DEFAULT 0 CHECK (satz_basis >= 0),   -- Cent je Stunde
  prozent int NOT NULL DEFAULT 30 CHECK (prozent BETWEEN 0 AND 100),
  betrag int NOT NULL DEFAULT 0,                                -- Cent, R-66
  abgerechnet boolean NOT NULL DEFAULT false,
  rechnung_id int REFERENCES rechnung(id) ON DELETE SET NULL,
  erstellt timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX zeiteintrag_projekt_ix ON zeiteintrag (projekt_id);
CREATE UNIQUE INDEX zeiteintrag_ein_timer_uk ON zeiteintrag (benutzer_id) WHERE laeuft_seit IS NOT NULL;  -- R-64

CREATE TABLE rechnung_position (
  id serial PRIMARY KEY,
  rechnung_id int NOT NULL REFERENCES rechnung(id) ON DELETE CASCADE,
  art text NOT NULL DEFAULT 'planungszeit',
  text text NOT NULL DEFAULT '',
  menge numeric(10,2) NOT NULL DEFAULT 0,
  einheit text NOT NULL DEFAULT 'Std.',
  einzelpreis int NOT NULL DEFAULT 0,
  betrag int NOT NULL DEFAULT 0,
  zeiteintrag_id int UNIQUE REFERENCES zeiteintrag(id) ON DELETE CASCADE
);
