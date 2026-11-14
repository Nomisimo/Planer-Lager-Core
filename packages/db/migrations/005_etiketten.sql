-- Phase 3: Kabel (3.12), Etiketten-Vorlagen und -Bestellungen (3.13, 4.4).

-- R-29a: jede Länge behält ihre Farbe für immer ('' = alle 12 Farben vergeben).
CREATE TABLE kabel_laenge (
  laenge_m numeric(8,2) PRIMARY KEY CHECK (laenge_m > 0),
  farbcode text NOT NULL DEFAULT '',
  erstellt timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION kabel_farbe_fest() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.farbcode <> '' AND NEW.farbcode IS DISTINCT FROM OLD.farbcode THEN
    RAISE EXCEPTION 'Die Farbe einer Kabellänge bleibt fest.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kabel_farbe_fest BEFORE UPDATE ON kabel_laenge FOR EACH ROW EXECUTE FUNCTION kabel_farbe_fest();

CREATE TABLE etikett_vorlage (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE CHECK (name <> ''),
  art text NOT NULL DEFAULT 'allgemein' CHECK (art IN ('allgemein', 'kabel')),
  breite_mm numeric(6,2) NOT NULL CHECK (breite_mm >= 10 AND breite_mm <= 300),
  hoehe_mm numeric(6,2) NOT NULL CHECK (hoehe_mm >= 5 AND hoehe_mm <= 300),
  farbe text NOT NULL DEFAULT '#ffffff',
  standard boolean NOT NULL DEFAULT false,
  elemente jsonb NOT NULL DEFAULT '[]',
  version int NOT NULL DEFAULT 1,
  geaendert timestamptz NOT NULL DEFAULT now()
);
-- je Art höchstens eine Standardvorlage
CREATE UNIQUE INDEX etikett_vorlage_standard ON etikett_vorlage (art) WHERE standard;

CREATE TABLE etikett_bestellung (
  id serial PRIMARY KEY,
  nummer text NOT NULL UNIQUE CHECK (nummer ~ '^EB-[0-9]{4}-[0-9]{3,}$'),
  lieferant text NOT NULL DEFAULT '',
  notiz text NOT NULL DEFAULT '',
  erstellt timestamptz NOT NULL DEFAULT now(),
  erstellt_von text NOT NULL DEFAULT '',
  bestellt_am date
);

CREATE TABLE etikett_code (
  id serial PRIMARY KEY,
  bestellung_id int NOT NULL REFERENCES etikett_bestellung(id) ON DELETE CASCADE,
  artikel_id int NOT NULL REFERENCES artikel(id) ON DELETE RESTRICT,
  code varchar(10) NOT NULL UNIQUE CHECK (code ~ '^[A-Z]{1,4}-[0-9]{4,}$'),
  geraet_id int UNIQUE REFERENCES geraet(id) ON DELETE SET NULL,
  geliefert_am timestamptz
);
CREATE INDEX etikett_code_bestellung ON etikett_code (bestellung_id);
CREATE INDEX etikett_code_artikel ON etikett_code (artikel_id);
