-- Basis: Hilfsfunktion für Nur-Anfügen-Tabellen (Bewegungen, Sicherheitsereignisse; ARCHITEKTUR §3).
CREATE OR REPLACE FUNCTION nur_anfuegen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Tabelle % erlaubt nur neue Einträge', TG_TABLE_NAME;
END $$;
