-- FA-22 Offline-Puffer: nachgebuchte Scans einmalig buchen (Wiederholung nach verlorener Antwort bucht nicht doppelt).
CREATE TABLE scan_offline (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 64),
  benutzer_id int REFERENCES benutzer(id) ON DELETE SET NULL,
  erfasst timestamptz NOT NULL,
  gebucht timestamptz NOT NULL DEFAULT now(),
  ergebnis jsonb NOT NULL
);
