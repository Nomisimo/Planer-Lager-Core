-- Einstellungen (3.14), Rollen/Benutzer (2.1–2.3), Sitzungen, Anmeldeversuche, Sicherheitsprotokoll (3.15).

CREATE TABLE einstellungen (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),       -- genau ein Datensatz
  werte jsonb NOT NULL DEFAULT '{}'::jsonb,
  geaendert timestamptz NOT NULL DEFAULT now()
);
INSERT INTO einstellungen (id) VALUES (1);

CREATE TABLE rolle (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  rechte jsonb NOT NULL DEFAULT '{}'::jsonb,
  eingebaut boolean NOT NULL DEFAULT false
);

CREATE TABLE benutzer (
  id serial PRIMARY KEY,
  benutzername text NOT NULL,
  name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  passwort_hash text NOT NULL,
  rolle_id integer NOT NULL REFERENCES rolle(id) ON DELETE RESTRICT,
  aktiv boolean NOT NULL DEFAULT true,
  totp_geheimnis text,
  totp_aktiv boolean NOT NULL DEFAULT false,
  design jsonb NOT NULL DEFAULT '{}'::jsonb,
  erstellt timestamptz NOT NULL DEFAULT now(),
  letzter_login timestamptz
);
CREATE UNIQUE INDEX benutzer_name_uk ON benutzer (lower(benutzername));

CREATE TABLE sitzung (
  token_hash text PRIMARY KEY,
  benutzer_id integer NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  art text NOT NULL CHECK (art IN ('app', 'web', 'zwischen')),  -- zwischen = Passwort ok, 2. Faktor fehlt
  csrf text,
  erstellt timestamptz NOT NULL DEFAULT now(),
  letzte_aktivitaet timestamptz NOT NULL DEFAULT now(),
  ip text NOT NULL DEFAULT '',
  geraet text NOT NULL DEFAULT ''
);
CREATE INDEX sitzung_benutzer_ix ON sitzung (benutzer_id);

CREATE TABLE handoff (
  code_hash text PRIMARY KEY,
  benutzer_id integer NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  ablauf timestamptz NOT NULL,
  eingeloest timestamptz
);

CREATE TABLE anmelde_versuch (
  id bigserial PRIMARY KEY,
  zeit timestamptz NOT NULL DEFAULT now(),
  benutzername text NOT NULL,
  ip text NOT NULL,
  erfolg boolean NOT NULL
);
CREATE INDEX anmelde_versuch_name_ix ON anmelde_versuch (lower(benutzername), zeit);
CREATE INDEX anmelde_versuch_ip_ix ON anmelde_versuch (ip, zeit);

CREATE TABLE sicherheit_ereignis (
  id bigserial PRIMARY KEY,
  zeit timestamptz NOT NULL DEFAULT now(),
  art text NOT NULL CHECK (art IN ('login', 'logout', 'fehlversuch', 'sperre', 'verweigert', 'aktion', 'download')),
  benutzer text NOT NULL DEFAULT '',
  ip text NOT NULL DEFAULT '',
  text text NOT NULL DEFAULT ''
);
CREATE INDEX sicherheit_ereignis_zeit_ix ON sicherheit_ereignis (zeit);
CREATE TRIGGER sicherheit_ereignis_nur_anfuegen BEFORE UPDATE OR DELETE ON sicherheit_ereignis
  FOR EACH ROW EXECUTE FUNCTION nur_anfuegen();
