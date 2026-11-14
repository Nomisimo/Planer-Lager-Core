// FA-40 Wiederkehrende Aufgaben: Rhythmus und fällige Termine (reine Fachlogik, Datum als JJJJ-MM-TT).
import { plusMonate } from "./pruefung.js";

export const RHYTHMEN = Object.freeze({ taeglich: "täglich", woechentlich: "wöchentlich", monatlich: "monatlich", jaehrlich: "jährlich" });

const plusTage = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Nächster Termin nach `iso` im Rhythmus (Monatsende bleibt Monatsende-nah, 31.01. → 28./29.02.). */
export function naechsterTermin(iso, rhythmus, alle = 1) {
  if (rhythmus === "taeglich") return plusTage(iso, alle);
  if (rhythmus === "woechentlich") return plusTage(iso, 7 * alle);
  if (rhythmus === "monatlich") return plusMonate(iso, alle);
  if (rhythmus === "jaehrlich") return plusMonate(iso, 12 * alle);
  throw new Error(`Unbekannter Rhythmus: ${rhythmus}`);
}

/**
 * Welche Aufgabe ist heute zu erzeugen? Eine Aufgabe entsteht `vorlauf_tage` vor ihrem Termin.
 * Verpasste Termine (Server war aus) ergeben nur eine Aufgabe für den jüngsten Termin.
 * @returns {{termin: string|null, naechste: string}}
 */
export function faelligeRegel(regel, heute) {
  let naechste = regel.naechste, termin = null;
  for (let i = 0; i < 5000 && plusTage(naechste, -(regel.vorlauf_tage || 0)) <= heute; i++) {
    termin = naechste;
    naechste = naechsterTermin(naechste, regel.rhythmus, regel.alle || 1);
  }
  return { termin, naechste };
}

/** Eingaben einer Regel prüfen. */
export function pruefeRegel(w) {
  const f = {};
  if (!String(w?.text ?? "").trim()) f.text = "Was ist zu tun? Text fehlt.";
  if (!RHYTHMEN[w?.rhythmus]) f.rhythmus = "Wähle täglich, wöchentlich, monatlich oder jährlich.";
  const alle = Number(w?.alle ?? 1);
  if (!Number.isInteger(alle) || alle < 1 || alle > 365) f.alle = "Ganze Zahl von 1 bis 365.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(w?.naechste ?? ""))) f.naechste = "Wähle das Datum des ersten Termins.";
  const v = Number(w?.vorlauf_tage ?? 0);
  if (!Number.isInteger(v) || v < 0 || v > 365) f.vorlauf_tage = "Vorlauf in ganzen Tagen von 0 bis 365.";
  return f;
}

/** Text „alle 2 Wochen“ usw. */
export function rhythmusText(rhythmus, alle = 1) {
  if (alle === 1) return RHYTHMEN[rhythmus] || rhythmus;
  return `alle ${alle} ${{ taeglich: "Tage", woechentlich: "Wochen", monatlich: "Monate", jaehrlich: "Jahre" }[rhythmus]}`;
}
