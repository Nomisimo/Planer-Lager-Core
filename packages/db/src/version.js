// GLEICH (ARCHITEKTUR §12): optimistisches Sperren, zentral für alle Datensätze mit Fassung (Migration 023).
// Der Trigger fassung_erhoehen() zählt die Fassung bei jeder echten Änderung hoch; hier wird beim Speichern verglichen.

/** Tabellen mit Spalte version (+ geaendert_von, geaendert_am). */
export const FASSUNG_TABELLEN = Object.freeze(["kunde", "projekt", "angebot", "angebot_position", "artikel", "geraet", "aufgabe", "ladezone",
  "etikett_vorlage", "einstellungen", "benutzer", "rolle", "kunde_kontakt", "lagerort", "kategorie", "reparatur", "personal", "einsatz",
  "fahrzeug", "fahrt", "scanner", "arbeitsplatz", "mitarbeiter", "projekt_vorlage", "aufgabe_regel", "projekt_datei", "etikett_bestellung"]);

/**
 * Prüft die mitgeschickte Fassung und sperrt die Zeile bis zum Ende der Transaktion (FOR UPDATE).
 * Das eigentliche UPDATE danach erhöht die Fassung über den Trigger.
 * @param {{query: Function}} c Verbindung (in einer Transaktion für die Sperre)
 * @param {string} tabelle eine aus FASSUNG_TABELLEN
 * @param {number} id
 * @param {number|string|null|undefined} version Fassung, mit der der Nutzer zu bearbeiten begann
 * @returns {Promise<{status: "ok", zeile: object} | {status: "konflikt", aktuell: object, von: string, am: Date|null}
 *   | {status: "geloescht", von: string, am: Date|null} | {status: "fehlt"}>}
 */
export async function pruefeFassung(c, tabelle, id, version) {
  if (!FASSUNG_TABELLEN.includes(tabelle)) throw new Error(`Tabelle ohne Fassung: ${tabelle}`);
  if (version === undefined || version === null || version === "" || !Number.isInteger(Number(version))) return { status: "fehlt" };
  const { rows: [z] } = await c.query(`SELECT * FROM ${tabelle} WHERE id = $1 FOR UPDATE`, [id]);
  if (!z) {
    const { rows: [g] } = await c.query("SELECT von, zeit FROM aenderung WHERE tabelle = $1 AND datensatz_id = $2 AND aktion = 'geloescht' ORDER BY zeit DESC LIMIT 1", [tabelle, id]);
    return { status: "geloescht", von: g?.von || "", am: g?.zeit || null };
  }
  if (Number(version) !== z.version) return { status: "konflikt", aktuell: z, von: z.geaendert_von || "", am: z.geaendert_am || null };
  return { status: "ok", zeile: z };
}
