// Einstellungen (Spec 3.14): genau ein Datensatz. Standardwerte zentral (NFA-07), Prüfung beim Speichern.

/** Standardwerte. Geldbeträge in Cent, Prozente als ganze Zahl. */
export const EINSTELLUNGEN_STANDARD = Object.freeze({
  firma: { name: "", strasse: "", plz: "", ort: "", telefon: "", email: "", web: "", ust_id: "", iban: "", bic: "", bank: "" },
  folgetag_prozent: 50,
  tag_stunden_standard: 8,
  tag_stunden_erweitert: 10,
  zonen_auto: true,
  angebot_gueltig_tage: 14,
  angebot_text_einleitung: "Vielen Dank für deine Anfrage. Gerne bieten wir dir folgende Leistungen an:",
  angebot_text_schluss: "Wir freuen uns auf die Zusammenarbeit.",
  etikett_format: "62x29",
  etiketten_lieferant: "Stromstoss",
  etiketten_hinweis: "",
  zeit_artikel: null,
  zeit_prozent_planung: 30,
  zeit_basis_stundensatz: 6000,
  backup_zweitordner: "",
  backup_behalten: 14,
  design_standard: { thema: "planer", dichte: "normal", modus: "system" },
});

const ZAHL = (min, max) => (v) => Number.isInteger(v) && v >= min && v <= max;
const PRUEFUNG = {
  folgetag_prozent: [ZAHL(0, 100), "Folgetag-Prozent muss eine ganze Zahl von 0 bis 100 sein."],
  tag_stunden_standard: [ZAHL(1, 24), "Stunden pro Tag (Standard) müssen zwischen 1 und 24 liegen."],
  tag_stunden_erweitert: [ZAHL(1, 24), "Stunden pro Tag (erweitert) müssen zwischen 1 und 24 liegen."],
  zonen_auto: [(v) => typeof v === "boolean", "Automatische Zonen ist ein Ja/Nein-Wert."],
  angebot_gueltig_tage: [ZAHL(1, 365), "Angebote müssen 1 bis 365 Tage gültig sein."],
  zeit_prozent_planung: [ZAHL(0, 100), "Planungsanteil muss zwischen 0 und 100 % liegen."],
  zeit_basis_stundensatz: [ZAHL(0, 10_000_000), "Stundensatz muss ein Betrag ab 0 sein."],
  backup_behalten: [ZAHL(1, 365), "Behalte mindestens 1 und höchstens 365 Sicherungen."],
  design_standard: [(v) => v && typeof v === "object" && (!v.thema || ["planer", "blau", "gruen", "violett", "orange", "petrol", "grau", "kontrast"].includes(v.thema))
    && (!v.dichte || ["kompakt", "normal", "gross"].includes(v.dichte)) && (!v.modus || ["system", "hell", "dunkel"].includes(v.modus)), "Wähle Thema, Abstände und Hell/Dunkel aus der Liste."],
  etikett_format: [(v) => typeof v === "string" && /^\d{1,3}x\d{1,3}$/.test(v), "Etikettenformat bitte als Breite x Höhe in mm angeben, z. B. 62x29."],
  backup_zweitordner: [(v) => typeof v === "string" && v.length <= 500, "Der Zweitort ist zu lang. Kürze die Angabe."],
  zeit_artikel: [(v) => v === null || Number.isInteger(v), "Wähle einen Artikel für die Zeiterfassung aus der Liste."],
};

/**
 * Führt gespeicherte Werte mit Standardwerten zusammen (neue Felder bekommen ihren Standard).
 * @param {object|null} gespeichert
 */
export function mitStandard(gespeichert) {
  const s = gespeichert || {};
  return {
    ...EINSTELLUNGEN_STANDARD, ...s,
    firma: { ...EINSTELLUNGEN_STANDARD.firma, ...(s.firma || {}) },
    design_standard: { ...EINSTELLUNGEN_STANDARD.design_standard, ...(s.design_standard || {}) },
  };
}

/**
 * Prüft eine Änderung. Unbekannte Felder werden abgelehnt.
 * @returns {{ok: true, werte: object} | {ok: false, fehler: Record<string,string>}}
 */
export function pruefeEinstellungen(aenderung, aktuell) {
  const fehler = {};
  for (const k of Object.keys(aenderung || {})) {
    if (!(k in EINSTELLUNGEN_STANDARD)) { fehler[k] = `Unbekannte Einstellung „${k}“. Lade die Seite neu.`; continue; }
    const p = PRUEFUNG[k];
    if (p && !p[0](aenderung[k])) fehler[k] = p[1];
  }
  const neu = mitStandard({ ...aktuell, ...aenderung,
    firma: { ...(aktuell?.firma || {}), ...(aenderung?.firma || {}) },
    design_standard: { ...(aktuell?.design_standard || {}), ...(aenderung?.design_standard || {}) } });
  if (neu.tag_stunden_erweitert < neu.tag_stunden_standard)
    fehler.tag_stunden_erweitert = "Der erweiterte Tag muss mindestens so lang sein wie der Standard-Tag.";
  return Object.keys(fehler).length ? { ok: false, fehler } : { ok: true, werte: neu };
}
