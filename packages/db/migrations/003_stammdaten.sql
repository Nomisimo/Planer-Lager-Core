-- Stammdaten: Kategorie (3.6), Artikel (3.7), Gerät (3.8), Bewegung (3.9). Geld in Cent, Prozente ganzzahlig.

CREATE TABLE kategorie (
  id serial PRIMARY KEY,
  name text NOT NULL,
  praefix text NOT NULL CHECK (praefix ~ '^[A-Z]{1,4}$'),
  letzte_nummer integer NOT NULL DEFAULT 0 CHECK (letzte_nummer >= 0)
);
CREATE UNIQUE INDEX kategorie_name_uk ON kategorie (lower(name));
CREATE UNIQUE INDEX kategorie_praefix_uk ON kategorie (praefix);

-- letzte_nummer nur steigend (3.6); Präfix nach Vergabe von Codes unveränderlich (Codes bleiben gültig).
CREATE OR REPLACE FUNCTION kategorie_nummer_steigend() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.letzte_nummer < OLD.letzte_nummer THEN RAISE EXCEPTION 'letzte_nummer darf nur steigen'; END IF;
  IF NEW.praefix <> OLD.praefix AND OLD.letzte_nummer > 0 THEN RAISE EXCEPTION 'Präfix ist schon vergeben worden und bleibt fest'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kategorie_nummer BEFORE UPDATE ON kategorie FOR EACH ROW EXECUTE FUNCTION kategorie_nummer_steigend();

CREATE TABLE artikel (
  id serial PRIMARY KEY,
  name text NOT NULL,
  kategorie_id integer NOT NULL REFERENCES kategorie(id) ON DELETE RESTRICT,
  hersteller text NOT NULL DEFAULT '',
  beschreibung text NOT NULL DEFAULT '',
  aktiv boolean NOT NULL DEFAULT true,
  preis_tag integer NOT NULL DEFAULT 0 CHECK (preis_tag >= 0),          -- Cent pro Stück und Tag
  folgetag_prozent integer CHECK (folgetag_prozent BETWEEN 0 AND 100),  -- NULL = Einstellungen
  verkaeuflich boolean NOT NULL DEFAULT false,
  verkaufspreis integer CHECK (verkaufspreis >= 0),
  mengenschritt integer NOT NULL DEFAULT 1 CHECK (mengenschritt >= 1),
  ist_case boolean NOT NULL DEFAULT false,
  inhalt_artikel_id integer REFERENCES artikel(id) ON DELETE SET NULL,
  verpackungseinheit integer CHECK (verpackungseinheit >= 0),
  ist_leistung boolean NOT NULL DEFAULT false,
  zeitmodell text CHECK (zeitmodell IN ('tag', 'stunde', 'pauschale')),
  preis_erweitert integer CHECK (preis_erweitert >= 0),
  verbrauch boolean NOT NULL DEFAULT false,
  bestand integer NOT NULL DEFAULT 0,
  mindestbestand integer,
  einheit text NOT NULL DEFAULT 'Stück',
  pruefpflichtig boolean NOT NULL DEFAULT true,
  pruef_intervall_monate integer NOT NULL DEFAULT 12 CHECK (pruef_intervall_monate BETWEEN 1 AND 120),
  plansymbol text NOT NULL DEFAULT '',
  laenge_m numeric(8,2) CHECK (laenge_m > 0),
  farbcode text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  erstellt timestamptz NOT NULL DEFAULT now(),
  geaendert timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX artikel_kategorie_ix ON artikel (kategorie_id);
CREATE INDEX artikel_name_ix ON artikel (lower(name));

CREATE TABLE geraet (
  id serial PRIMARY KEY,
  code varchar(10) NOT NULL UNIQUE CHECK (code ~ '^[A-Z]{1,4}-[0-9]{4,}$'),
  artikel_id integer NOT NULL REFERENCES artikel(id) ON DELETE RESTRICT,
  alte_pruef_id text NOT NULL DEFAULT '',
  seriennummer text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'lager' CHECK (status IN ('lager','zugeordnet','gepackt','vermisst','defekt','reparatur','ausgemustert','verkauft')),
  projekt_id integer,                                                    -- FK folgt mit Projekt (Phase 4), SET NULL
  case_id integer REFERENCES geraet(id) ON DELETE SET NULL,
  letzte_pruefung date,
  notizen text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  erstellt timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX geraet_artikel_ix ON geraet (artikel_id);
CREATE INDEX geraet_projekt_ix ON geraet (projekt_id);
CREATE INDEX geraet_case_ix ON geraet (case_id);
CREATE INDEX geraet_alte_pruef_ix ON geraet (alte_pruef_id) WHERE alte_pruef_id <> '';
-- Code nicht editierbar (3.8)
CREATE OR REPLACE FUNCTION geraet_code_fest() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.code <> OLD.code THEN RAISE EXCEPTION 'Gerätecode ist nicht änderbar'; END IF; RETURN NEW; END $$;
CREATE TRIGGER geraet_code BEFORE UPDATE ON geraet FOR EACH ROW EXECUTE FUNCTION geraet_code_fest();

-- Bewegung: nur anfügen (3.9). RESTRICT statt CASCADE: Geräte mit Verlauf sind nicht löschbar (R-19 SOLL, D-37).
CREATE TABLE bewegung (
  id bigserial PRIMARY KEY,
  geraet_id integer NOT NULL REFERENCES geraet(id) ON DELETE RESTRICT,
  projekt_id integer,
  aktion text NOT NULL,
  benutzer text NOT NULL DEFAULT '',
  mitarbeiter text NOT NULL DEFAULT '',
  zeit timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bewegung_geraet_ix ON bewegung (geraet_id, zeit DESC);
CREATE INDEX bewegung_projekt_ix ON bewegung (projekt_id);
CREATE TRIGGER bewegung_nur_anfuegen BEFORE UPDATE OR DELETE ON bewegung FOR EACH ROW EXECUTE FUNCTION nur_anfuegen();
