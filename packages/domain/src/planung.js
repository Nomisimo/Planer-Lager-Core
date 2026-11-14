// Planungszeit (Spec 3.5, 5.11 R-62–R-66, FA-46): reine Regeln für Kontext, Timer-Stopp und Satz.
import { rundeCent } from "./geld.js";

export const TIMER_LEERLAUF_S = 300;   // R-63
export const HERZSCHLAG_S = 30;        // Ping-Abstand der Oberfläche

/** R-62: Projektseiten, die nicht als Planung gelten (Packen, Rückgabe, Arbeit vor Ort). */
const KEINE_PLANUNG = /^\/projekte\/\d+\/(packen|rueckgabe|status|zone|verladen|anzeige)(\/|$)/;
/** R-63: neutrale Seiten unterbrechen den Timer nicht. */
const NEUTRAL = [/^\/zeiterfassung(\/|$)/, /^\/material(\/|$)/, /^\/geraete(\/|$)/, /^\/suche(\/|$)/, /^\/kalender(\/|$)/, /^\/design(\/|$)/, /^\/ich(\/|$)/,
  /^\/angebote\/\d+(\/|$)/]; // Angebot ohne bekanntes Projekt (lädt noch) unterbricht nicht; mit Projekt → Planung daran

/**
 * R-62/R-63: Kontext einer Seite. Liefert { projekt: id } (Planung an diesem Projekt), { neutral: true } oder { planung: false }.
 * `projektId` setzt eine Seite selbst, deren Pfad das Projekt nicht enthält (z. B. ein Angebot des Projekts).
 */
export function planungsKontext(pfad, projektId = null) {
  const p = String(pfad || "/").split("?")[0];
  if (KEINE_PLANUNG.test(p)) return { planung: false };
  if (projektId) return { projekt: Number(projektId) };
  const m = /^\/projekte\/(\d+)(\/|$)/.exec(p);
  if (m) return { projekt: Number(m[1]) };
  if (NEUTRAL.some((r) => r.test(p))) return { neutral: true };
  return { planung: false };
}

/**
 * R-63: Was passiert mit einem laufenden Timer bei einem Herzschlag?
 * timer {projekt_id, laeuft_seit, zuletzt_aktiv}, kontext aus planungsKontext, aktiv = Eingabe seit letztem Herzschlag.
 * Liefert { aktion: "weiter" } oder { aktion: "stopp", ende: Date }.
 */
export function herzschlag(timer, kontext, jetzt = Date.now(), aktiv = true) {
  const zuletzt = new Date(timer.zuletzt_aktiv || timer.laeuft_seit).getTime();
  if (jetzt - zuletzt > TIMER_LEERLAUF_S * 1000) return { aktion: "stopp", ende: new Date(zuletzt), grund: "leerlauf" };
  if (kontext?.neutral) return { aktion: "weiter", aktiv };
  if (kontext?.projekt && Number(kontext.projekt) === Number(timer.projekt_id)) return { aktion: "weiter", aktiv };
  return { aktion: "stopp", ende: new Date(jetzt), grund: kontext?.projekt ? "anderes_projekt" : "keine_planung" };
}

/** Minuten zwischen Start und Ende (gerundet, nie negativ). */
export const timerMinuten = (laeuftSeit, ende) => Math.max(0, Math.round((new Date(ende).getTime() - new Date(laeuftSeit).getTime()) / 60000));

/**
 * R-66: Stundensatz-Basis in Cent. Posten „Technische Projektleitung“ (einstellungen.zeit_artikel):
 * je Stunde → Preis; sonst Tagessatz ÷ tag_stunden_standard; ohne Posten → Ersatz-Stundensatz.
 */
export function satzBasis(artikel, einstellungen) {
  if (artikel) {
    if (artikel.zeitmodell === "stunde") return Number(artikel.preis_tag) || 0;
    return rundeCent((Number(artikel.preis_tag) || 0) / (Number(einstellungen.tag_stunden_standard) || 8));
  }
  return Number(einstellungen.zeit_basis_stundensatz) || 0;
}

/** R-66: Betrag eines Zeiteintrags = Minuten/60 × Basis × Prozent. Integer-Cent, kaufmännisch gerundet. */
export const zeitBetrag = (minuten, basis, prozent) => rundeCent((Number(minuten) * Number(basis) * Number(prozent)) / 6000);

/** Stunden als „1:30 h“. */
export const dauerText = (minuten) => `${Math.floor(minuten / 60)}:${String(minuten % 60).padStart(2, "0")} h`;

/** R-65 Nachbuchen: Eingaben prüfen. */
export function pruefeZeiteintrag(w) {
  const fehler = {};
  const projekt = Number(w?.projekt_id);
  if (!Number.isInteger(projekt) || projekt <= 0) fehler.projekt_id = "Wähle das Projekt.";
  const datum = String(w?.datum || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || Number.isNaN(Date.parse(datum))) fehler.datum = "Gib ein gültiges Datum ein.";
  const minuten = Number(w?.minuten);
  if (!Number.isInteger(minuten) || minuten < 1 || minuten > 24 * 60) fehler.minuten = "Dauer in Minuten von 1 bis 1440.";
  return { fehler, werte: { projekt_id: projekt, datum, minuten, beschreibung: String(w?.beschreibung || "").trim().slice(0, 500) } };
}

/** „1:30“, „90“ oder „1,5“ → Minuten (oder NaN). */
export function minutenAus(text) {
  const t = String(text || "").trim();
  let m = /^(\d{1,2}):([0-5]\d)$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d{1,2})[,.](\d{1,2})\s*h?$/.exec(t);
  if (m) return Math.round(Number(`${m[1]}.${m[2]}`) * 60);
  m = /^(\d{1,4})$/.exec(t);
  return m ? Number(m[1]) : NaN;
}
