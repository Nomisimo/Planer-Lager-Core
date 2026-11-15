-- Phase 18 Tour (ARCHITEKTUR §11): „Willkommen gesehen“ und erledigte Touren am Benutzer, damit sie in beiden Apps gelten.
ALTER TABLE benutzer ADD COLUMN tour jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Tour-Stand ist eine persönliche Einstellung wie die Darstellung: kein Eintrag im Änderungsprotokoll, keine neue Fassung.
DROP TRIGGER aenderung_benutzer ON benutzer;
CREATE TRIGGER aenderung_benutzer AFTER INSERT OR UPDATE OR DELETE ON benutzer FOR EACH ROW
  EXECUTE FUNCTION aenderung_protokollieren('design', 'letzter_login', 'tour');
DROP TRIGGER fassung_benutzer ON benutzer;
CREATE TRIGGER fassung_benutzer BEFORE UPDATE ON benutzer FOR EACH ROW EXECUTE FUNCTION fassung_erhoehen('letzter_login', 'design', 'tour');
