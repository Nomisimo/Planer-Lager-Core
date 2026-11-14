// Artikel (Spec 3.7) und Material-aufnehmen-Formular (5.13, R-71).
import { plansymbolGueltig } from "./plansymbole.js";

/** Artikeltyp aus Kennzeichen, Reihenfolge laut 3.7. */
export function artikeltyp(a) {
  if (a.ist_leistung) return "Dienstleistung";
  if (a.ist_case) return "Case";
  if (a.verbrauch) return "Verbrauch";
  if ((a.mengenschritt || 1) > 1) return `nur ${a.mengenschritt}er-Set`;
  return "Artikel";
}
export const ARTIKELTYPEN = ["Dienstleistung", "Case", "Verbrauch", "Set", "Artikel"];

/** Soll-Inhalt eines Cases: inhalt_artikel.mengenschritt, sonst verpackungseinheit. */
export function sollInhalt(caseArtikel, inhaltArtikel) {
  if (!caseArtikel?.ist_case) return 0;
  if (inhaltArtikel && (inhaltArtikel.mengenschritt || 1) > 1) return inhaltArtikel.mengenschritt;
  return caseArtikel.verpackungseinheit || 0;
}

/** R-71: Arten im Formular. */
export const ARTEN = ["geraet", "case", "verbrauch", "leistung", "kabel"];
export const ART_TITEL = { geraet: "Gerät", case: "Case/Tasche", verbrauch: "Verbrauch", leistung: "Leistung", kabel: "Kabel" };

/** Felder, die je Art sichtbar sind (R-71). */
export const ART_FELDER = {
  geraet: ["name", "kategorie_id", "hersteller", "beschreibung", "preis_tag", "folgetag_prozent", "verkaeuflich", "verkaufspreis", "mengenschritt", "pruefpflichtig", "pruef_intervall_monate", "plansymbol", "wartung_intervall_monate", "wartung_text", "gewicht_kg", "lagerort_id", "aktiv"],
  case: ["name", "kategorie_id", "hersteller", "beschreibung", "preis_tag", "folgetag_prozent", "inhalt_artikel_id", "verpackungseinheit", "pruefpflichtig", "pruef_intervall_monate", "plansymbol", "wartung_intervall_monate", "wartung_text", "gewicht_kg", "lagerort_id", "aktiv"],
  verbrauch: ["name", "kategorie_id", "hersteller", "beschreibung", "preis_tag", "verkaeuflich", "verkaufspreis", "bestand", "mindestbestand", "einheit", "gewicht_kg", "lagerort_id", "aktiv"],
  leistung: ["name", "kategorie_id", "beschreibung", "preis_tag", "zeitmodell", "preis_erweitert", "aktiv"],
  kabel: ["name", "kategorie_id", "hersteller", "beschreibung", "preis_tag", "folgetag_prozent", "laenge_m", "pruefpflichtig", "pruef_intervall_monate", "wartung_intervall_monate", "wartung_text", "gewicht_kg", "lagerort_id", "aktiv"],
};

/** Art aus vorhandenem Artikel ableiten. */
export function artVon(a) {
  if (a.ist_leistung) return "leistung";
  if (a.verbrauch) return "verbrauch";
  if (a.ist_case) return "case";
  if (a.laenge_m != null && a.laenge_m !== "") return "kabel";
  return "geraet";
}

/** R-71: Art setzt die Kennzeichen; Verbrauch/Leistung leeren laenge_m. */
export function wendeArtAn(werte, art) {
  const w = { ...werte, ist_case: art === "case", verbrauch: art === "verbrauch", ist_leistung: art === "leistung" };
  if (art === "verbrauch" || art === "leistung") w.laenge_m = null;
  if (art !== "case") { w.inhalt_artikel_id = null; w.verpackungseinheit = null; }
  if (art === "leistung") { w.pruefpflichtig = false; w.mengenschritt = 1; }
  if (art === "verbrauch") { w.pruefpflichtig = false; }
  return w;
}

/** Hat der Artikel Einzelgeräte (mit Code)? Verbrauch und Leistung nicht. */
export const hatGeraete = (a) => !a.verbrauch && !a.ist_leistung;
/** FA-01 Akzeptanz: Warnzeichen bei Bestand ≤ Mindestbestand. */
export const bestandNiedrig = (a) => !!a.verbrauch && a.mindestbestand != null && (a.bestand ?? 0) <= a.mindestbestand;

/** Prüft Artikel-Werte (Geld in Cent). @returns Fehler je Feld */
export function pruefeArtikel(w) {
  const f = {};
  if (!String(w.name || "").trim()) f.name = "Name fehlt. Bitte ausfüllen.";
  if (!Number.isInteger(w.kategorie_id)) f.kategorie_id = "Wähle eine Kategorie.";
  const cent = (k, titel) => { if (w[k] != null && (!Number.isInteger(w[k]) || w[k] < 0)) f[k] = `${titel} muss ein Betrag ab 0 sein.`; };
  cent("preis_tag", "Tagespreis"); cent("verkaufspreis", "Verkaufspreis"); cent("preis_erweitert", "Erweiterter Preis");
  if (w.mengenschritt != null && (!Number.isInteger(w.mengenschritt) || w.mengenschritt < 1)) f.mengenschritt = "Mengenschritt muss mindestens 1 sein.";
  if (w.folgetag_prozent != null && (!Number.isInteger(w.folgetag_prozent) || w.folgetag_prozent < 0 || w.folgetag_prozent > 100)) f.folgetag_prozent = "Folgetag-Prozent muss zwischen 0 und 100 liegen.";
  if (w.pruef_intervall_monate != null && (!Number.isInteger(w.pruef_intervall_monate) || w.pruef_intervall_monate < 1 || w.pruef_intervall_monate > 120)) f.pruef_intervall_monate = "Prüfintervall: 1 bis 120 Monate.";
  if (w.wartung_intervall_monate != null && (!Number.isInteger(w.wartung_intervall_monate) || w.wartung_intervall_monate < 1 || w.wartung_intervall_monate > 120)) f.wartung_intervall_monate = "Wartungsintervall: 1 bis 120 Monate oder leer.";
  if (w.gewicht_kg != null && w.gewicht_kg !== "" && !(Number(w.gewicht_kg) >= 0)) f.gewicht_kg = "Gewicht in kg ab 0 oder leer.";
  if (w.laenge_m != null && w.laenge_m !== "" && !(Number(w.laenge_m) > 0)) f.laenge_m = "Länge muss größer als 0 m sein.";
  if (w.ist_case && w.inhalt_artikel_id == null && !(w.verpackungseinheit > 0)) f.verpackungseinheit = "Gib an, wie viele Teile in das Case gehören, oder wähle einen Inhalt-Artikel.";
  if (!plansymbolGueltig(w.plansymbol)) f.plansymbol = "Wähle ein Plan-Symbol aus der Liste (oder leer = automatisch).";
  if (w.ist_leistung && w.zeitmodell && !["tag", "stunde", "pauschale"].includes(w.zeitmodell)) f.zeitmodell = "Wähle ein Zeitmodell aus der Liste.";
  return f;
}
