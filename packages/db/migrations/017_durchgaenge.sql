-- FA-20 Packdurchgänge (Verladen, Rückgabe) je Projekt mit Zeit und Person; FA-21 Grundlage für Lieferschein/Rückgabeprotokoll.
CREATE TABLE projekt_durchgang (
  id serial PRIMARY KEY,
  projekt_id int NOT NULL REFERENCES projekt(id) ON DELETE RESTRICT,
  art text NOT NULL CHECK (art IN ('verladen', 'rueckgabe')),
  nr int NOT NULL CHECK (nr >= 1),
  zeit timestamptz NOT NULL DEFAULT now(),
  von text NOT NULL DEFAULT '',
  geraete jsonb NOT NULL DEFAULT '[]',   -- verladen: alle gepackten Geräte (neu = seit dem letzten Verladen); rueckgabe: zurückgegeben
  fehlt jsonb NOT NULL DEFAULT '[]',     -- rueckgabe: noch am Projekt (offen oder vermisst)
  defekt jsonb NOT NULL DEFAULT '[]',    -- rueckgabe: mit Mangel zurück
  UNIQUE (projekt_id, art, nr)
);
CREATE TRIGGER projekt_durchgang_nur_anfuegen BEFORE UPDATE OR DELETE ON projekt_durchgang FOR EACH ROW EXECUTE FUNCTION nur_anfuegen();
