-- Phase 5: Angebot, AngebotPosition, AngebotFassung (3.11, 4.2), Reservierungen (R-24, R-25). Geld in Cent.

CREATE TABLE angebot (
  id serial PRIMARY KEY,
  nummer text NOT NULL UNIQUE CHECK (nummer ~ '^A-[0-9]{4}-[0-9]{3,}$'),
  projekt_id int NOT NULL REFERENCES projekt(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf', 'versendet', 'angenommen', 'abgelehnt')),
  datum date NOT NULL DEFAULT ((now() AT TIME ZONE 'Europe/Berlin')::date),
  gueltig_bis date,
  betreff text NOT NULL DEFAULT '',
  einleitung text NOT NULL DEFAULT '',
  schlusstext text NOT NULL DEFAULT '',
  tage int NOT NULL DEFAULT 1 CHECK (tage BETWEEN 1 AND 3650),
  rabatt_prozent numeric(5,2) NOT NULL DEFAULT 0 CHECK (rabatt_prozent BETWEEN 0 AND 100),
  folgetag_prozent int NOT NULL DEFAULT 50 CHECK (folgetag_prozent BETWEEN 0 AND 100),
  kleinunternehmer boolean NOT NULL DEFAULT false,
  ust_satz numeric(4,2) NOT NULL DEFAULT 19 CHECK (ust_satz BETWEEN 0 AND 99),
  fassung int NOT NULL DEFAULT 0 CHECK (fassung >= 0),
  pdf_datei text NOT NULL DEFAULT '',
  summe_netto int NOT NULL DEFAULT 0,
  version int NOT NULL DEFAULT 1,
  erstellt timestamptz NOT NULL DEFAULT now(),
  erstellt_von text NOT NULL DEFAULT '',
  geaendert timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX angebot_projekt_ix ON angebot (projekt_id);
CREATE INDEX angebot_status_ix ON angebot (status);

CREATE TABLE angebot_position (
  id serial PRIMARY KEY,
  angebot_id int NOT NULL REFERENCES angebot(id) ON DELETE CASCADE,
  pos int NOT NULL,
  art text NOT NULL CHECK (art IN ('miete', 'verkauf', 'frei')),
  artikel_id int REFERENCES artikel(id) ON DELETE RESTRICT,
  bezeichnung text NOT NULL DEFAULT '',
  menge numeric(10,2) NOT NULL CHECK (menge > 0),
  tage int NOT NULL DEFAULT 1 CHECK (tage BETWEEN 1 AND 3650),
  einzelpreis int NOT NULL DEFAULT 0 CHECK (einzelpreis >= 0),
  folgetag_prozent int CHECK (folgetag_prozent BETWEEN 0 AND 100),
  einheit text NOT NULL DEFAULT 'Stück',
  beschreibung text NOT NULL DEFAULT '',
  mengenschritt int NOT NULL DEFAULT 1 CHECK (mengenschritt >= 1),
  stunden numeric(5,2) CHECK (stunden >= 0),          -- Personal (Zeitrechner R-28c), sonst NULL
  CHECK (art = 'frei' OR artikel_id IS NOT NULL)
);
CREATE INDEX angebot_position_angebot_ix ON angebot_position (angebot_id, pos);
CREATE INDEX angebot_position_artikel_ix ON angebot_position (artikel_id) WHERE artikel_id IS NOT NULL;

CREATE TABLE angebot_fassung (
  id serial PRIMARY KEY,
  angebot_id int NOT NULL REFERENCES angebot(id) ON DELETE CASCADE,
  fassung int NOT NULL,
  status text NOT NULL,
  pdf_datei text NOT NULL DEFAULT '',
  summe_netto int NOT NULL DEFAULT 0,
  daten jsonb NOT NULL DEFAULT '{}',
  erstellt timestamptz NOT NULL DEFAULT now(),
  erstellt_von text NOT NULL DEFAULT '',
  UNIQUE (angebot_id, fassung)
);

-- R-24/R-25: aktive Reservierungen je Mietposition-Artikel. Zeitraum = Projekt beginn..ende (fehlt ende: beginn).
CREATE VIEW reservierung AS
SELECT ap.artikel_id, sum(ap.menge)::numeric AS menge, a.id AS angebot_id, a.nummer AS angebot_nummer, a.status AS angebot_status,
       p.id AS projekt_id, p.nummer AS projekt_nummer, p.name AS projekt_name,
       p.beginn AS von, coalesce(p.ende, p.beginn) AS bis, (a.status = 'angenommen') AS fest
FROM angebot_position ap
JOIN angebot a ON a.id = ap.angebot_id
JOIN projekt p ON p.id = a.projekt_id
WHERE ap.art = 'miete' AND ap.artikel_id IS NOT NULL
  AND ((a.status = 'angenommen' AND p.status NOT IN ('abgeschlossen', 'storniert'))
    OR (a.status = 'versendet' AND (a.gueltig_bis IS NULL OR a.gueltig_bis >= (now() AT TIME ZONE 'Europe/Berlin')::date)))
GROUP BY ap.artikel_id, a.id, p.id;
