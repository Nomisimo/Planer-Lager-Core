// FA-07 Reparatur und Wartung.
import { plusMonate } from "./pruefung.js";
import { heuteIso } from "./zeit.js";

export const REPARATUR_STATUS = Object.freeze({ gemeldet: "Gemeldet", in_reparatur: "In Reparatur", repariert: "Repariert/geprüft", ausgemustert: "Ausgemustert" });
export const REPARATUR_OFFEN = Object.freeze(["gemeldet", "in_reparatur"]);

/** Gerätestatus, der zum Reparaturstatus gehört. */
export const GERAET_ZU_REPARATUR = Object.freeze({ gemeldet: "defekt", in_reparatur: "reparatur", repariert: "lager", ausgemustert: "ausgemustert" });

const WEGE = { gemeldet: ["in_reparatur", "repariert", "ausgemustert"], in_reparatur: ["repariert", "ausgemustert"] };

/**
 * Prüft einen Statuswechsel. „Repariert/geprüft“ (zurück in den Bestand) nur mit bestandener Prüfung.
 * @returns {string|null} Fehlertext oder null
 */
export function reparaturWechselFehler(von, nach, { pruefungOk } = {}) {
  if (!REPARATUR_STATUS[nach]) return "Wähle einen Status aus der Liste.";
  if (!(WEGE[von] || []).includes(nach)) return `Von „${REPARATUR_STATUS[von] || von}“ geht es nicht nach „${REPARATUR_STATUS[nach]}“. Die Reparatur ist schon abgeschlossen.`;
  if (nach === "repariert" && pruefungOk !== true) return "Zurück in den Bestand erst nach bestandener Prüfung. Prüfe das Gerät und hake „Prüfung bestanden“ an.";
  return null;
}

export const WARTUNG_VORLAUF_TAGE = 30;

/**
 * Wartung fällig? Nur für Artikel mit Wartungsintervall.
 * @returns {{status: "keine"|"offen"|"faellig"|"bald"|"ok", naechste: string|null}}
 */
export function wartungStatus(artikel, letzteWartung, heute = heuteIso()) {
  if (!artikel?.wartung_intervall_monate) return { status: "keine", naechste: null };
  if (!letzteWartung) return { status: "offen", naechste: null };
  const naechste = plusMonate(letzteWartung, artikel.wartung_intervall_monate);
  if (naechste <= heute) return { status: "faellig", naechste };
  // D-93: in den nächsten 30 Tagen fällig = „bald“ (steht schon in der Wartungsliste)
  const grenze = new Date(`${heute}T12:00:00Z`); grenze.setUTCDate(grenze.getUTCDate() + WARTUNG_VORLAUF_TAGE);
  return { status: naechste <= grenze.toISOString().slice(0, 10) ? "bald" : "ok", naechste };
}
