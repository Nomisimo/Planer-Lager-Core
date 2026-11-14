-- FA-55 Änderungsprotokoll (wer/wann/was alt -> neu) für Stammdaten: Artikel, Kunden, Projekte, Rechte (Rollen, Benutzer).
-- Ein Trigger je Tabelle schreibt jede Änderung mit, auch Änderungen aus Hintergrundabläufen.
-- Wer: der Server setzt je Anfrage die Sitzungsvariable lager.wer (leer = „System“).
CREATE TABLE aenderung (
  id bigserial PRIMARY KEY,
  zeit timestamptz NOT NULL DEFAULT now(),
  tabelle text NOT NULL,
  datensatz_id int NOT NULL,
  bezeichnung text NOT NULL DEFAULT '',
  aktion text NOT NULL CHECK (aktion IN ('angelegt', 'geaendert', 'geloescht', 'anonymisiert')),
  von text NOT NULL DEFAULT '',
  felder jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX aenderung_datensatz ON aenderung (tabelle, datensatz_id, zeit DESC);
CREATE INDEX aenderung_zeit ON aenderung (zeit DESC);

-- TG_ARGV: Spalten, die nicht protokolliert werden (laufender Betrieb statt Stammdaten).
CREATE FUNCTION aenderung_protokollieren() RETURNS trigger LANGUAGE plpgsql AS $$
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
    CONTINUE WHEN k = ANY (TG_ARGV) OR k IN ('id', 'version', 'erstellt', 'geaendert', 'erstellt_von');
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

CREATE TRIGGER aenderung_artikel AFTER INSERT OR UPDATE OR DELETE ON artikel FOR EACH ROW EXECUTE FUNCTION aenderung_protokollieren();
CREATE TRIGGER aenderung_kunde AFTER INSERT OR UPDATE OR DELETE ON kunde FOR EACH ROW EXECUTE FUNCTION aenderung_protokollieren();
CREATE TRIGGER aenderung_projekt AFTER INSERT OR UPDATE OR DELETE ON projekt FOR EACH ROW
  EXECUTE FUNCTION aenderung_protokollieren('ordner', 'ladezone_id', 'zone_seit', 'gepackt_am', 'gepackt_von_id', 'gepackt_von_name');
CREATE TRIGGER aenderung_rolle AFTER INSERT OR UPDATE OR DELETE ON rolle FOR EACH ROW EXECUTE FUNCTION aenderung_protokollieren();
CREATE TRIGGER aenderung_benutzer AFTER INSERT OR UPDATE OR DELETE ON benutzer FOR EACH ROW
  EXECUTE FUNCTION aenderung_protokollieren('design', 'letzter_login');
