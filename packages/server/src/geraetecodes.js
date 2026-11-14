// Gerätecodes vergeben (R-21) – gemeinsam für Geräte und Etiketten-Bestellungen (R-67).
import { naechsterGeraetecode } from "@lager/domain";
import { fehler, nichtGefunden } from "./hilfen.js";

/** Reserviert n fortlaufende Codes der Kategorie (nie wiederverwendet, auch nicht bestellte). */
export async function vergibCodes(c, kategorieId, anzahl) {
  const { rows: [k] } = await c.query("SELECT id, praefix, letzte_nummer FROM kategorie WHERE id = $1 FOR UPDATE", [kategorieId]);
  if (!k) throw nichtGefunden("Diese Kategorie");
  const { rows: [m] } = await c.query(`SELECT coalesce(max(substring(code from '-([0-9]+)$')::int), 0) AS n FROM (
      SELECT code FROM geraet WHERE code LIKE $1 || '-%' UNION ALL SELECT code FROM etikett_code WHERE code LIKE $1 || '-%') x`, [k.praefix]);
  let letzte = Math.max(k.letzte_nummer, m.n);
  const codes = [];
  for (let i = 0; i < anzahl; i++) { const n = naechsterGeraetecode(k.praefix, letzte, []); codes.push(n.code); letzte = n.nummer; }
  await c.query("UPDATE kategorie SET letzte_nummer = $1 WHERE id = $2", [letzte, k.id]);
  return codes;
}

/** Legt n Geräte eines Artikels an (Codes nach R-21). */
export async function legeGeraeteAn(c, artikelId, anzahl, w = {}) {
  const { rows: [a] } = await c.query("SELECT id, kategorie_id, verbrauch, ist_leistung FROM artikel WHERE id = $1", [artikelId]);
  if (!a) throw nichtGefunden("Dieser Artikel");
  if (a.verbrauch || a.ist_leistung) throw fehler(400, "Verbrauchsmaterial und Leistungen haben keine Einzelgeräte. Ändere stattdessen den Bestand.");
  if (!Number.isInteger(anzahl) || anzahl < 1 || anzahl > 500) throw fehler(400, "Anzahl muss zwischen 1 und 500 liegen.", { felder: { anzahl: "1 bis 500" } });
  const codes = w.codes || await vergibCodes(c, a.kategorie_id, anzahl);
  const ids = [];
  for (const code of codes) {
    const { rows } = await c.query("INSERT INTO geraet (code, artikel_id) VALUES ($1, $2) RETURNING id", [code, artikelId]);
    ids.push(rows[0].id);
  }
  return { codes, ids };
}

