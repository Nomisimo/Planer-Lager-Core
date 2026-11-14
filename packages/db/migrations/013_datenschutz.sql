-- NFA-03 Löschkonzept: Zeitpunkt der Anonymisierung eines Kunden (Nummer und Belege bleiben).
ALTER TABLE kunde ADD COLUMN anonymisiert timestamptz;
