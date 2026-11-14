// Prüfstatus eines Geräts (Spec 5.10).
import { heuteIso } from "./zeit.js";

/** Datum + n Monate, Monatsende berücksichtigt (31.01. + 1 Monat = 28./29.02.). ISO-Strings. */
export function plusMonate(iso, monate) {
  const [y, m, d] = iso.split("-").map(Number);
  const ziel = new Date(Date.UTC(y, m - 1 + monate, 1));
  const letzter = new Date(Date.UTC(ziel.getUTCFullYear(), ziel.getUTCMonth() + 1, 0)).getUTCDate();
  ziel.setUTCDate(Math.min(d, letzter));
  return ziel.toISOString().slice(0, 10);
}
const tageZwischen = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

export const PRUEF_TEXT = { keine: "keine Prüfpflicht", offen: "nie geprüft", ueberfaellig: "überfällig", bald: "bald fällig", ok: "geprüft" };

/**
 * @param {{pruefpflichtig: boolean, pruef_intervall_monate?: number}} artikel
 * @param {string|null} letztePruefung ISO
 * @returns {{status: "keine"|"offen"|"ueberfaellig"|"bald"|"ok", naechste: string|null}}
 */
export function pruefstatus(artikel, letztePruefung, heute = heuteIso()) {
  if (!artikel?.pruefpflichtig) return { status: "keine", naechste: null };
  if (!letztePruefung) return { status: "offen", naechste: null };
  const naechste = plusMonate(letztePruefung, artikel.pruef_intervall_monate || 12);
  if (naechste < heute) return { status: "ueberfaellig", naechste };
  if (tageZwischen(heute, naechste) <= 30) return { status: "bald", naechste };
  return { status: "ok", naechste };
}
