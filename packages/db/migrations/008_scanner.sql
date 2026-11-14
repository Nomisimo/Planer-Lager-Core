-- Netzwerk-Scanner (ARCHITEKTUR §5): Gateway-Zuordnung zu Arbeitsplatz. FK auf arbeitsplatz folgt mit Phase 8.
CREATE TABLE scanner (
  id serial PRIMARY KEY,
  name text NOT NULL CHECK (btrim(name) <> ''),
  kennung text NOT NULL DEFAULT '' CHECK (kennung ~ '^[A-Za-z0-9_-]{0,20}$'),
  ip text NOT NULL DEFAULT '',
  token_hash text NOT NULL DEFAULT '',
  arbeitsplatz_id int,
  aktiv boolean NOT NULL DEFAULT true,
  letzter_kontakt timestamptz,
  letzter_code text NOT NULL DEFAULT '',
  erstellt timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX scanner_name_uk ON scanner (lower(name));
CREATE UNIQUE INDEX scanner_kennung_uk ON scanner (lower(kennung)) WHERE kennung <> '';
CREATE UNIQUE INDEX scanner_ip_uk ON scanner (ip) WHERE ip <> '';
