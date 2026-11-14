-- Phase 4: Projekt/Job (3.2, 4.1), Projektdateien (3.3), Aufgaben (3.4).

CREATE TABLE projekt (
  id serial PRIMARY KEY,
  nummer text NOT NULL UNIQUE CHECK (nummer ~ '^[PJ]-[0-9]{4}-[0-9]{3,}$'),
  art text NOT NULL CHECK (art IN ('projekt', 'job')),
  uebergeordnet_id int REFERENCES projekt(id) ON DELETE RESTRICT,
  gewerk text NOT NULL DEFAULT '',
  name text NOT NULL CHECK (name <> ''),
  kunde_id int NOT NULL REFERENCES kunde(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'anfrage' CHECK (status IN ('anfrage', 'angebot_gesendet', 'bestaetigt', 'laeuft', 'abgeschlossen', 'storniert')),
  beginn date,
  ende date,
  ort text NOT NULL DEFAULT '',
  notizen text NOT NULL DEFAULT '',
  ordner text NOT NULL DEFAULT '',
  ladezone_id int,
  zone_seit timestamptz,
  gepackt_am timestamptz,
  gepackt_von_id int,
  gepackt_von_name text NOT NULL DEFAULT '',
  version int NOT NULL DEFAULT 1,
  erstellt timestamptz NOT NULL DEFAULT now(),
  erstellt_von text NOT NULL DEFAULT '',
  geaendert timestamptz NOT NULL DEFAULT now(),
  CHECK (art = 'job' OR uebergeordnet_id IS NULL),
  CHECK (art = 'job' OR gewerk = ''),
  CHECK (ende IS NULL OR beginn IS NULL OR ende >= beginn),
  CHECK (uebergeordnet_id IS DISTINCT FROM id)
);
CREATE INDEX projekt_status_ix ON projekt (status);
CREATE INDEX projekt_kunde_ix ON projekt (kunde_id);
CREATE INDEX projekt_eltern_ix ON projekt (uebergeordnet_id);
CREATE INDEX projekt_zeit_ix ON projekt (beginn, ende);

-- FA-30 Akzeptanz: genau eine Ebene; Job hat immer den Kunden des Projekts; Projekt mit Jobs wird nie Job.
CREATE FUNCTION projekt_ebene() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE eltern projekt%ROWTYPE;
BEGIN
  IF NEW.uebergeordnet_id IS NOT NULL THEN
    SELECT * INTO eltern FROM projekt WHERE id = NEW.uebergeordnet_id;
    IF eltern.art <> 'projekt' THEN RAISE EXCEPTION 'Ein Job kann keine Unter-Jobs haben' USING ERRCODE = 'P0001'; END IF;
    NEW.kunde_id := eltern.kunde_id;
  END IF;
  IF NEW.art = 'job' AND EXISTS (SELECT 1 FROM projekt WHERE uebergeordnet_id = NEW.id) THEN
    RAISE EXCEPTION 'Ein Projekt mit Jobs kann nicht zum Job werden' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER projekt_ebene BEFORE INSERT OR UPDATE ON projekt FOR EACH ROW EXECUTE FUNCTION projekt_ebene();

CREATE FUNCTION projekt_kunde_an_jobs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kunde_id IS DISTINCT FROM OLD.kunde_id THEN
    UPDATE projekt SET kunde_id = NEW.kunde_id WHERE uebergeordnet_id = NEW.id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER projekt_kunde_an_jobs AFTER UPDATE OF kunde_id ON projekt FOR EACH ROW EXECUTE FUNCTION projekt_kunde_an_jobs();

-- Geräte und Bewegungen verweisen jetzt echt auf Projekte.
UPDATE geraet SET projekt_id = NULL WHERE projekt_id IS NOT NULL AND projekt_id NOT IN (SELECT id FROM projekt);
ALTER TABLE geraet ADD CONSTRAINT geraet_projekt_fk FOREIGN KEY (projekt_id) REFERENCES projekt(id) ON DELETE RESTRICT;
ALTER TABLE bewegung ADD CONSTRAINT bewegung_projekt_fk FOREIGN KEY (projekt_id) REFERENCES projekt(id) ON DELETE RESTRICT NOT VALID;

CREATE TABLE projekt_datei (
  id serial PRIMARY KEY,
  projekt_id int NOT NULL REFERENCES projekt(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (name <> ''),
  pfad text NOT NULL,
  kategorie text NOT NULL DEFAULT 'sonstiges' CHECK (kategorie IN ('plan', 'technik', 'vertrag', 'foto', 'sonstiges')),
  beschreibung text NOT NULL DEFAULT '',
  groesse bigint NOT NULL CHECK (groesse >= 0 AND groesse <= 52428800),
  hochgeladen timestamptz NOT NULL DEFAULT now(),
  von text NOT NULL DEFAULT ''
);
CREATE INDEX projekt_datei_projekt_ix ON projekt_datei (projekt_id);

CREATE TABLE aufgabe (
  id serial PRIMARY KEY,
  projekt_id int NOT NULL REFERENCES projekt(id) ON DELETE CASCADE,
  text text NOT NULL CHECK (text <> ''),
  erledigt boolean NOT NULL DEFAULT false,
  erledigt_am timestamptz,
  faellig date,
  zugewiesen_id int REFERENCES benutzer(id) ON DELETE SET NULL,
  von text NOT NULL DEFAULT '',
  erstellt timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX aufgabe_projekt_ix ON aufgabe (projekt_id);
CREATE INDEX aufgabe_offen_ix ON aufgabe (faellig) WHERE NOT erledigt;
