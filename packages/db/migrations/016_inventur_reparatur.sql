-- FA-06 Inventur: Lauf je Lagerbereich (Kategorie, D-92), Scans, Abschluss mit Protokoll.
CREATE TABLE inventur (
  id serial PRIMARY KEY,
  kategorie_id int REFERENCES kategorie(id) ON DELETE RESTRICT,   -- NULL = gesamter Bestand
  status text NOT NULL DEFAULT 'offen' CHECK (status IN ('offen', 'abgeschlossen', 'abgebrochen')),
  gestartet timestamptz NOT NULL DEFAULT now(),
  gestartet_von text NOT NULL DEFAULT '',
  abgeschlossen timestamptz,
  abgeschlossen_von text NOT NULL DEFAULT '',
  soll jsonb,                 -- beim Abschluss eingefroren: [{id, code, artikel, status}]
  ergebnis jsonb              -- beim Abschluss: {ok, fehlt, zuViel, unbekannt}
);
CREATE UNIQUE INDEX inventur_offen_uk ON inventur (coalesce(kategorie_id, 0)) WHERE status = 'offen';

CREATE TABLE inventur_scan (
  id serial PRIMARY KEY,
  inventur_id int NOT NULL REFERENCES inventur(id) ON DELETE CASCADE,
  code text NOT NULL,
  geraet_id int REFERENCES geraet(id) ON DELETE RESTRICT,
  zeit timestamptz NOT NULL DEFAULT now(),
  von text NOT NULL DEFAULT '',
  UNIQUE (inventur_id, code)
);

-- FA-07 Reparatur: Defekt-Meldung mit Foto, Beschreibung, Verantwortlichem, Status und Kosten.
CREATE TABLE reparatur (
  id serial PRIMARY KEY,
  geraet_id int NOT NULL REFERENCES geraet(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'gemeldet' CHECK (status IN ('gemeldet', 'in_reparatur', 'repariert', 'ausgemustert')),
  beschreibung text NOT NULL CHECK (btrim(beschreibung) <> ''),
  verantwortlich_id int REFERENCES benutzer(id) ON DELETE SET NULL,
  kosten int CHECK (kosten >= 0),                -- Cent, optional
  foto text NOT NULL DEFAULT '',                 -- Dateiname im Datenordner reparatur/<id>/
  pruefung_ok boolean,                           -- Prüfung vor Rückgabe in den Bestand
  notiz text NOT NULL DEFAULT '',
  gemeldet timestamptz NOT NULL DEFAULT now(),
  gemeldet_von text NOT NULL DEFAULT '',
  geaendert timestamptz NOT NULL DEFAULT now(),
  erledigt timestamptz,
  version int NOT NULL DEFAULT 1
);
CREATE INDEX reparatur_geraet_ix ON reparatur (geraet_id);
CREATE UNIQUE INDEX reparatur_offen_uk ON reparatur (geraet_id) WHERE status IN ('gemeldet', 'in_reparatur');

-- FA-07 Wartung (nicht prüfpflichtig, z. B. Lüfter reinigen): Intervall je Artikel, letzte Wartung je Gerät.
ALTER TABLE artikel ADD COLUMN wartung_intervall_monate int CHECK (wartung_intervall_monate BETWEEN 1 AND 120);
ALTER TABLE artikel ADD COLUMN wartung_text text NOT NULL DEFAULT '';
ALTER TABLE geraet ADD COLUMN letzte_wartung date;
