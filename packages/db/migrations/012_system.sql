-- FA-51: Laufzeit-Zustand des Servers (z. B. Wartung), überlebt Neustarts.
CREATE TABLE system_zustand (
  schluessel text PRIMARY KEY,
  wert jsonb NOT NULL,
  geaendert timestamptz NOT NULL DEFAULT now()
);
