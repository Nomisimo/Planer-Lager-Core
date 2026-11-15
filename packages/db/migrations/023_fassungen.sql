-- GLEICH (ZUSATZ.md, ARCHITEKTUR §12): optimistisches Sperren. Jede Zeile trägt eine Fassung (version).
-- Der Trigger erhöht sie bei jeder echten Änderung und merkt sich wer/wann; der Server vergleicht beim Speichern
-- die mitgeschickte Fassung (packages/db/src/version.js) und antwortet sonst mit 409 + aktueller Fassung.
-- TG_ARGV: Spalten aus dem laufenden Betrieb (Anmeldung, Sperre, Kontakt), die keine neue Fassung auslösen.
-- Setzt ein UPDATE die Fassung selbst weiter (version = version + 1, z. B. wenn sich nur Kindzeilen wie
-- Angebotspositionen geändert haben), gilt das ebenfalls als Änderung.
CREATE FUNCTION fassung_erhoehen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ign text[] := ARRAY['version', 'geaendert_von', 'geaendert_am', 'geaendert'] || TG_ARGV;
  alt jsonb := to_jsonb(OLD);
  neu jsonb := to_jsonb(NEW);
  k text;
BEGIN
  FOREACH k IN ARRAY ign LOOP alt := alt - k; neu := neu - k; END LOOP;
  IF alt IS DISTINCT FROM neu OR NEW.version IS DISTINCT FROM OLD.version THEN
    NEW.version := OLD.version + 1;
    NEW.geaendert_von := coalesce(nullif(current_setting('lager.wer', true), ''), 'System');
    NEW.geaendert_am := now();
  ELSE
    NEW.version := OLD.version;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION aenderung_protokollieren() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  alt jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  neu jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  x jsonb := coalesce(neu, alt);
  f jsonb := '[]';
  k text;
  a jsonb;
  n jsonb;
  aktion text := CASE TG_OP WHEN 'INSERT' THEN 'angelegt' WHEN 'UPDATE' THEN 'geaendert' ELSE 'geloescht' END;
  bez text := coalesce(nullif(concat_ws(' ', x->>'nummer', x->>'name'), ''), x->>'benutzername', '');
  wer text := coalesce(nullif(current_setting('lager.wer', true), ''), 'System');
BEGIN
  -- DSGVO (NFA-03): beim Anonymisieren oder Löschen eines Kunden keine personenbezogenen Altwerte aufheben
  IF TG_TABLE_NAME = 'kunde' AND (TG_OP = 'DELETE' OR (alt->>'anonymisiert') IS NULL AND (neu->>'anonymisiert') IS NOT NULL) THEN
    DELETE FROM aenderung WHERE tabelle = 'kunde' AND datensatz_id = (x->>'id')::int;
    INSERT INTO aenderung (tabelle, datensatz_id, bezeichnung, aktion, von)
      VALUES ('kunde', (x->>'id')::int, CASE WHEN TG_OP = 'DELETE' THEN 'Kunde ' || (x->>'id') ELSE coalesce(neu->>'name', '') END,
        CASE WHEN TG_OP = 'DELETE' THEN 'geloescht' ELSE 'anonymisiert' END, wer);
    RETURN NULL;
  END IF;
  FOR k IN SELECT jsonb_object_keys(x) LOOP
    CONTINUE WHEN k = ANY (TG_ARGV) OR k IN ('id', 'version', 'erstellt', 'geaendert', 'erstellt_von', 'geaendert_von', 'geaendert_am');
    a := CASE WHEN alt IS NULL THEN 'null' ELSE alt->k END;
    n := CASE WHEN neu IS NULL THEN 'null' ELSE neu->k END;
    CONTINUE WHEN a IS NOT DISTINCT FROM n;
    CONTINUE WHEN TG_OP <> 'UPDATE' AND ((CASE WHEN TG_OP = 'INSERT' THEN n ELSE a END) IN ('null', '""', '[]', '{}', 'false'));
    IF k IN ('passwort_hash', 'totp_geheimnis') THEN
      f := f || jsonb_build_object('feld', k, 'alt', null, 'neu', 'geändert');
    ELSE
      f := f || jsonb_build_object('feld', k, 'alt', CASE WHEN TG_OP = 'INSERT' THEN 'null' ELSE a END, 'neu', CASE WHEN TG_OP = 'DELETE' THEN 'null' ELSE n END);
    END IF;
  END LOOP;
  IF TG_OP = 'UPDATE' AND f = '[]' THEN RETURN NULL; END IF;
  INSERT INTO aenderung (tabelle, datensatz_id, bezeichnung, aktion, von, felder) VALUES (TG_TABLE_NAME, (x->>'id')::int, bez, aktion, wer, f);
  RETURN NULL;
END $$;

ALTER TABLE kunde ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1, ADD COLUMN geaendert_von text, ADD COLUMN geaendert_am timestamptz;
CREATE TRIGGER fassung_kunde BEFORE UPDATE ON kunde FOR EACH ROW EXECUTE FUNCTION fassung_erhoehen();
ALTER TABLE projekt ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1, ADD COLUMN geaendert_von text, ADD COLUMN geaendert_am timestamptz;
CREATE TRIGGER fassung_projekt BEFORE UPDATE ON projekt FOR EACH ROW EXECUTE FUNCTION fassung_erhoehen();
ALTER TABLE angebot ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1, ADD COLUMN geaendert_von text, ADD COLUMN geaendert_am timestamptz;
CREATE TRIGGER fassung_angebot BEFORE UPDATE ON angebot FOR EACH ROW EXECUTE FUNCTION fassung_erhoehen();
ALTER TABLE angebot_position ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1, ADD COLUMN geaendert_von text, ADD COLUMN geaendert_am timestamptz;
CREATE TRIGGER fassung_angebot_position BEFORE UPDATE ON angebot_position FOR EACH ROW EXECUTE FUNCTION fassung_erhoehen();
ALTER TABLE artikel ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1, ADD COLUMN geaendert_von text, ADD COLUMN geaendert_am timestamptz;
CREATE TRIGGER fassung_artikel BEFORE UPDATE ON artikel FOR EACH ROW EXECUTE FUNCTION fassung_erhoehen();
ALTER TABLE geraet ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1, ADD COLUMN geaendert_von text, ADD COLUMN geaendert_am timestamptz;
CREATE TRIGGER fassung_geraet BEFORE UPDATE ON geraet FOR EACH ROW EXECUTE FUNCTION fassung_erhoehen();
ALTER TABLE aufgabe ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1, ADD COLUMN geaendert_von text, ADD COLUMN geaendert_am timestamptz;
CREATE TRIGGER fassung_aufgabe BEFORE UPDATE ON aufgabe FOR EACH ROW EXECUTE FUNCTION fassung_erhoehen();
ALTER TABLE ladezone ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1, ADD COLUMN geaendert_von text, ADD COLUMN geaendert_am timestamptz;
CREATE TRIGGER fassung_ladezone BEFORE UPDATE ON ladezone FOR EACH ROW EXECUTE FUNCTION fassung_erhoehen();
ALTER TABLE etikett_vorlage ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1, ADD COLUMN geaendert_von text, ADD COLUMN geaendert_am timestamptz;
CREATE TRIGGER fassung_etikett_vorlage BEFORE UPDATE ON etikett_vorlage FOR EACH ROW EXECUTE FUNCTION fassung_erhoehen();
ALTER TABLE einstellungen ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1, ADD COLUMN geaendert_von text, ADD COLUMN geaendert_am timestamptz;
CREATE TRIGGER fassung_einstellungen BEFORE UPDATE ON einstellungen FOR EACH ROW EXECUTE FUNCTION fassung_erhoehen();
ALTER TABLE benutzer ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1, ADD COLUMN geaendert_von text, ADD COLUMN geaendert_am timestamptz;
CREATE TRIGGER fassung_benutzer BEFORE UPDATE ON benutzer FOR EACH ROW EXECUTE FUNCTION fassung_erhoehen('letzter_login', 'design');
ALTER TABLE rolle ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1, ADD COLUMN geaendert_von text, ADD COLUMN geaendert_am timestamptz;
CREATE TRIGGER fassung_rolle BEFORE UPDATE ON rolle FOR EACH ROW EXECUTE FUNCTION fassung_erhoehen();
ALTER TABLE kunde_kontakt ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1, ADD COLUMN geaendert_von text, ADD COLUMN geaendert_am timestamptz;
CREATE TRIGGER fassung_kunde_kontakt BEFORE UPDATE ON kunde_kontakt FOR EACH ROW EXECUTE FUNCTION fassung_erhoehen();
ALTER TABLE lagerort ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1, ADD COLUMN geaendert_von text, ADD COLUMN geaendert_am timestamptz;
CREATE TRIGGER fassung_lagerort BEFORE UPDATE ON lagerort FOR EACH ROW EXECUTE FUNCTION fassung_erhoehen();
ALTER TABLE kategorie ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1, ADD COLUMN geaendert_von text, ADD COLUMN geaendert_am timestamptz;
CREATE TRIGGER fassung_kategorie BEFORE UPDATE ON kategorie FOR EACH ROW EXECUTE FUNCTION fassung_erhoehen();
ALTER TABLE reparatur ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1, ADD COLUMN geaendert_von text, ADD COLUMN geaendert_am timestamptz;
CREATE TRIGGER fassung_reparatur BEFORE UPDATE ON reparatur FOR EACH ROW EXECUTE FUNCTION fassung_erhoehen();
ALTER TABLE personal ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1, ADD COLUMN geaendert_von text, ADD COLUMN geaendert_am timestamptz;
CREATE TRIGGER fassung_personal BEFORE UPDATE ON personal FOR EACH ROW EXECUTE FUNCTION fassung_erhoehen();
ALTER TABLE einsatz ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1, ADD COLUMN geaendert_von text, ADD COLUMN geaendert_am timestamptz;
CREATE TRIGGER fassung_einsatz BEFORE UPDATE ON einsatz FOR EACH ROW EXECUTE FUNCTION fassung_erhoehen();
ALTER TABLE fahrzeug ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1, ADD COLUMN geaendert_von text, ADD COLUMN geaendert_am timestamptz;
CREATE TRIGGER fassung_fahrzeug BEFORE UPDATE ON fahrzeug FOR EACH ROW EXECUTE FUNCTION fassung_erhoehen();
ALTER TABLE fahrt ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1, ADD COLUMN geaendert_von text, ADD COLUMN geaendert_am timestamptz;
CREATE TRIGGER fassung_fahrt BEFORE UPDATE ON fahrt FOR EACH ROW EXECUTE FUNCTION fassung_erhoehen();
ALTER TABLE scanner ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1, ADD COLUMN geaendert_von text, ADD COLUMN geaendert_am timestamptz;
CREATE TRIGGER fassung_scanner BEFORE UPDATE ON scanner FOR EACH ROW EXECUTE FUNCTION fassung_erhoehen('letzter_kontakt', 'letzter_code');
ALTER TABLE arbeitsplatz ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1, ADD COLUMN geaendert_von text, ADD COLUMN geaendert_am timestamptz;
CREATE TRIGGER fassung_arbeitsplatz BEFORE UPDATE ON arbeitsplatz FOR EACH ROW EXECUTE FUNCTION fassung_erhoehen('mitarbeiter_id', 'letzte_aktivitaet', 'fehlversuche', 'gesperrt_bis', 'letzter_kontakt', 'einrichtung_hash', 'einrichtung_bis');
ALTER TABLE mitarbeiter ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1, ADD COLUMN geaendert_von text, ADD COLUMN geaendert_am timestamptz;
CREATE TRIGGER fassung_mitarbeiter BEFORE UPDATE ON mitarbeiter FOR EACH ROW EXECUTE FUNCTION fassung_erhoehen();
ALTER TABLE projekt_vorlage ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1, ADD COLUMN geaendert_von text, ADD COLUMN geaendert_am timestamptz;
CREATE TRIGGER fassung_projekt_vorlage BEFORE UPDATE ON projekt_vorlage FOR EACH ROW EXECUTE FUNCTION fassung_erhoehen();
ALTER TABLE aufgabe_regel ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1, ADD COLUMN geaendert_von text, ADD COLUMN geaendert_am timestamptz;
CREATE TRIGGER fassung_aufgabe_regel BEFORE UPDATE ON aufgabe_regel FOR EACH ROW EXECUTE FUNCTION fassung_erhoehen();
ALTER TABLE projekt_datei ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1, ADD COLUMN geaendert_von text, ADD COLUMN geaendert_am timestamptz;
CREATE TRIGGER fassung_projekt_datei BEFORE UPDATE ON projekt_datei FOR EACH ROW EXECUTE FUNCTION fassung_erhoehen();
ALTER TABLE etikett_bestellung ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1, ADD COLUMN geaendert_von text, ADD COLUMN geaendert_am timestamptz;
CREATE TRIGGER fassung_etikett_bestellung BEFORE UPDATE ON etikett_bestellung FOR EACH ROW EXECUTE FUNCTION fassung_erhoehen();
