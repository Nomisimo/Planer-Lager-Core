// Angebote (3.11, 4.2), Verfügbarkeit (5.2, R-24–R-27), Preise (5.3, R-28–R-28c), Packliste (5.7, R-51–R-54).
// Geld immer Integer-Cent. Mengen dürfen gebrochen sein (z. B. 2,5 Stunden bei freien Positionen).
import { rundeCent, centMalProzent } from "./geld.js";

export const ANGEBOT_STATUS = Object.freeze({ entwurf: "Entwurf", versendet: "Versendet", angenommen: "Angenommen", abgelehnt: "Abgelehnt" });
export const ANGEBOT_FARBE = Object.freeze({ entwurf: "#8a8f96", versendet: "#d08a1e", angenommen: "#2e9d47", abgelehnt: "#b3483f" });
export const POSITION_ARTEN = Object.freeze({ miete: "Miete", verkauf: "Verkauf", frei: "Freie Position" });

// 4.2: Entwurf -> Versendet -> Angenommen | Abgelehnt. Versendet -> Versendet = neue Fassung.
// Zurück auf Entwurf ist zur Korrektur erlaubt (wie R-12 bei Projekten), aus Angenommen nur über Versendet.
const UEBERGAENGE = {
  entwurf: ["versendet"],
  versendet: ["versendet", "angenommen", "abgelehnt", "entwurf"],
  angenommen: ["versendet"],
  abgelehnt: ["entwurf", "versendet"],
};
export const angebotWechselErlaubt = (von, nach) => (UEBERGAENGE[von] || []).includes(nach);
/** Bearbeiten nur, solange das Angebot nicht angenommen oder abgelehnt ist. */
export const angebotBearbeitbar = (status) => status === "entwurf" || status === "versendet";

/** Projektstatus nach Angebotswechsel (D-55): versendet → angebot_gesendet, angenommen → bestaetigt (nur vorwärts). */
export function projektStatusNachAngebot(projektStatus, angebotStatus) {
  if (angebotStatus === "versendet" && projektStatus === "anfrage") return "angebot_gesendet";
  if (angebotStatus === "angenommen" && ["anfrage", "angebot_gesendet"].includes(projektStatus)) return "bestaetigt";
  return null;
}

/**
 * R-28a Tagesfaktor als Bruch in Hundertsteln (ganzzahlig, ohne Float): 100 = Faktor 1.
 * Miete und Tage > 1: 1 + (Tage − 1) × Folgetag% / 100. Verkauf: 1. Frei: Anzahl Tage (mind. 1).
 */
export function tagesfaktorHundertstel(art, tage, folgetagProzent) {
  const t = Math.max(1, Math.floor(Number(tage) || 1));
  if (art === "miete") return t > 1 ? 100 + (t - 1) * Number(folgetagProzent ?? 0) : 100;
  if (art === "frei") return t * 100;
  return 100;
}
export const tagesfaktor = (art, tage, folgetagProzent) => tagesfaktorHundertstel(art, tage, folgetagProzent) / 100;

/** R-28 Positionssumme = Menge × Tagesfaktor × Einzelpreis, kaufmännisch auf Cent gerundet. */
export function positionSumme(p) {
  const menge = Number(p.menge) || 0;
  const preis = Number(p.einzelpreis) || 0;
  // menge kann bis zu 2 Nachkommastellen haben: in Hundertstel umrechnen, damit nur ganze Zahlen multipliziert werden.
  const mengeH = Math.round(menge * 100);
  return rundeCent((mengeH * tagesfaktorHundertstel(p.art, p.tage, p.folgetag_prozent) * preis) / 10000);
}

/**
 * R-28b Angebotssumme: Zwischensumme − Rabatt (auf die Gesamtsumme, gerundet) = Netto; USt nur ohne Kleinunternehmer.
 * @param {Array} positionen @param {{rabatt_prozent?:number, kleinunternehmer?:boolean, ust_satz?:number}} kopf
 */
export function angebotSumme(positionen, kopf = {}) {
  const zwischensumme = (positionen || []).reduce((s, p) => s + positionSumme(p), 0);
  const rabatt = centMalProzent(zwischensumme, Number(kopf.rabatt_prozent) || 0);
  const netto = zwischensumme - rabatt;
  const ust = kopf.kleinunternehmer ? 0 : centMalProzent(netto, Number(kopf.ust_satz ?? 19));
  return { zwischensumme, rabatt, netto, ust, brutto: netto + ust };
}

/** FA-41 Mengenschritt-Prüfung: Mietmenge muss Vielfaches des Sets sein. Liefert Fehlertext oder null. */
export function mengenschrittFehler(menge, schritt) {
  const k = Number(schritt) || 1;
  if (k <= 1) return null;
  if (Number(menge) % k === 0) return null;
  const vorschlag = Math.max(k, Math.ceil(Number(menge) / k) * k);
  return `Dieser Artikel wird nur im ${k}er-Set vermietet. Nimm ${vorschlag} statt ${String(menge).replace(".", ",")}.`;
}

/** Prüft eine Position. Liefert Fehlertext oder null. */
export function pruefePosition(p) {
  if (!POSITION_ARTEN[p.art]) return "Wähle die Art der Position (Miete, Verkauf oder frei).";
  if (p.art !== "frei" && !p.artikel_id) return "Wähle für Miete und Verkauf einen Artikel aus der Liste.";
  if (p.art === "frei" && !String(p.bezeichnung || "").trim()) return "Gib der freien Position eine Bezeichnung.";
  const m = Number(p.menge);
  if (!Number.isFinite(m) || m <= 0 || Math.round(m * 100) !== m * 100) return "Menge muss größer als 0 sein (höchstens 2 Nachkommastellen).";
  if (!Number.isInteger(Number(p.tage)) || Number(p.tage) < 1 || Number(p.tage) > 3650) return "Tage müssen eine ganze Zahl ab 1 sein.";
  if (!Number.isInteger(Number(p.einzelpreis)) || Number(p.einzelpreis) < 0) return "Einzelpreis muss ein Betrag ab 0 € sein.";
  const f = p.folgetag_prozent;
  if (f != null && (!Number.isInteger(Number(f)) || f < 0 || f > 100)) return "Folgetag-Prozent muss zwischen 0 und 100 liegen.";
  if (p.art === "miete") return mengenschrittFehler(m, p.mengenschritt);
  return null;
}

/**
 * R-24 Reservierungsart einer Mietposition: "fest", "vorgemerkt" oder null.
 * @param {{status:string, gueltig_bis?:string|null}} angebot @param {{status:string}} projekt @param {string} heute ISO
 */
export function reservierungsArt(angebot, projekt, heute) {
  if (angebot.status === "angenommen" && !["abgeschlossen", "storniert"].includes(projekt.status)) return "fest";
  if (angebot.status === "versendet" && (!angebot.gueltig_bis || angebot.gueltig_bis >= heute)) return "vorgemerkt";
  return null;
}

/** R-25 Zeitraum einer Reservierung: beginn bis ende (fehlt ende: beginn). */
export const reservierungsZeitraum = (projekt) => ({ von: projekt.beginn || null, bis: projekt.ende || projekt.beginn || null });

/** R-25 Überschneidung; fehlt ein Datum, gilt sie vorsichtshalber immer. */
export function ueberschneidet(a, b) {
  if (!a.von || !a.bis || !b.von || !b.bis) return true;
  return a.von <= b.bis && a.bis >= b.von;
}

/** R-17 einsatzfähige Gerätestatus. */
export const EINSATZFAEHIG = Object.freeze(["lager", "zugeordnet", "gepackt"]);

/** R-26 Bestand: Dienstleistung = unbegrenzt (null), Verbrauch = bestand, sonst Anzahl einsatzfähiger Geräte. */
export function bestandVon(artikel, einsatzfaehigeGeraete) {
  if (artikel.ist_leistung) return null;
  if (artikel.verbrauch) return Number(artikel.bestand) || 0;
  return einsatzfaehigeGeraete;
}

/**
 * R-27 Verfügbar = Bestand − Summe überschneidender Reservierungen (außer dem bearbeiteten Angebot).
 * @param {number|null} bestand @param {Array<{menge:number, von:string|null, bis:string|null, angebot_id:number}>} reservierungen
 * @param {{von:string|null, bis:string|null}} zeitraum @param {number|null} ausserAngebot
 * @returns {{bestand:number|null, reserviert:number, verfuegbar:number|null}}
 */
export function verfuegbarkeit(bestand, reservierungen, zeitraum, ausserAngebot = null) {
  const reserviert = (reservierungen || [])
    .filter((r) => r.angebot_id !== ausserAngebot && ueberschneidet(r, zeitraum))
    .reduce((s, r) => s + Number(r.menge), 0);
  return { bestand, reserviert, verfuegbar: bestand == null ? null : bestand - reserviert };
}

/** FA-42 Hinweistext bei Überbuchung, sonst null. Blockiert nie (R-27). */
export function ueberbuchungHinweis(menge, v) {
  if (!v || v.verfuegbar == null) return null;
  const fehlt = Number(menge) - v.verfuegbar;
  if (fehlt <= 0) return null;
  return `Überbucht: ${fmtMenge(fehlt)} fehlen (Bestand ${v.bestand}, im Zeitraum schon reserviert ${fmtMenge(v.reserviert)}). Speichern geht trotzdem; plane Zukauf oder Nachmiete ein.`;
}
const fmtMenge = (m) => String(Math.round(Number(m) * 100) / 100).replace(".", ",");

/**
 * R-28c Zeitmodell Personal: Tagessatz bis tag_stunden_standard, darüber erweiterter Tagessatz bis
 * tag_stunden_erweitert; darüber Überstunden zum Stundensatz erweiterter Satz / erweiterte Stunden (D-56).
 * @param {number} stunden @param {{tagessatz:number, erweitert?:number|null, zeitmodell?:string}} preis Cent
 * @param {{tag_stunden_standard:number, tag_stunden_erweitert:number}} e
 */
export function zeitrechner(stunden, preis, e) {
  const h = Math.max(0, Number(stunden) || 0);
  const modell = preis.zeitmodell || "tag";
  if (modell === "pauschale") return { stufe: "pauschale", satz: preis.tagessatz, ueberstunden: 0, ueberstundenSatz: 0, summe: preis.tagessatz };
  if (modell === "stunde") return { stufe: "stunde", satz: preis.tagessatz, ueberstunden: 0, ueberstundenSatz: 0, summe: rundeCent(h * preis.tagessatz) };
  const std = e.tag_stunden_standard, erw = e.tag_stunden_erweitert;
  const erweitert = preis.erweitert ?? preis.tagessatz;
  if (h <= std) return { stufe: "standard", satz: preis.tagessatz, ueberstunden: 0, ueberstundenSatz: 0, summe: preis.tagessatz };
  if (h <= erw) return { stufe: "erweitert", satz: erweitert, ueberstunden: 0, ueberstundenSatz: 0, summe: erweitert };
  const ueberstunden = Math.round((h - erw) * 100) / 100;
  const ueberstundenSatz = rundeCent(erweitert / erw);
  return { stufe: "ueberstunden", satz: erweitert, ueberstunden, ueberstundenSatz, summe: erweitert + rundeCent(ueberstunden * ueberstundenSatz) };
}

/**
 * R-51–R-54 Packliste aus Angebotspositionen.
 * @param {Array<{art:string, artikel_id:number|null, menge:number}>} positionen
 * @param {Map<number,object>} artikel id → {id,name,kategorie,ist_leistung,verbrauch,ist_case,mengenschritt,verpackungseinheit,inhalt}
 * @param {Map<number,{ist:number,gepackt:number}>} zaehler Geräte dieses Artikels im Projekt
 */
export function packliste(positionen, artikel, zaehler = new Map()) {
  const soll = new Map();
  for (const p of positionen || []) {
    if (!["miete", "verkauf"].includes(p.art) || !p.artikel_id) continue;
    const a = artikel.get(p.artikel_id);
    if (!a || a.ist_leistung) continue;
    soll.set(a.id, (soll.get(a.id) || 0) + Number(p.menge));
  }
  const zeilen = [...soll.entries()].map(([id, s]) => {
    const a = artikel.get(id);
    const z = { artikel_id: id, artikel: a.name, kategorie: a.kategorie || "", soll: s, verbrauch: !!a.verbrauch, einheit: a.einheit || "Stück" };
    if (a.verbrauch) Object.assign(z, { ist: null, gepackt: null, fertig: null });
    else {
      const c = zaehler.get(id) || { ist: 0, gepackt: 0 };
      Object.assign(z, { ist: c.ist, gepackt: c.gepackt, fertig: c.gepackt >= s });
    }
    const k = a.mengenschritt || 1;
    if (k > 1 && s % k === 0) z.set = { anzahl: s / k, groesse: k, text: `${s / k} × ${k}er-Set` };
    if (a.ist_case && a.inhalt) z.inhalt = { artikel: a.inhalt.name, soll: a.soll_inhalt, text: `Inhalt: ${a.inhalt.name} × ${a.soll_inhalt}` };
    return z;
  });
  zeilen.sort((x, y) => x.kategorie.localeCompare(y.kategorie, "de") || x.artikel.localeCompare(y.artikel, "de"));
  return zeilen;
}

/** Positionen für Fassung/PDF anreichern: Summe je Position. */
export const mitSummen = (positionen) => (positionen || []).map((p) => ({ ...p, summe: positionSumme(p) }));

/**
 * FA-45 Kalkulator: Position aus Artikel grob kalkulieren (ohne Angebot, ohne Reservierung).
 * Leistung → Personal mit Zeitrechner je Tag; Verbrauch → Verkauf; sonst Miete mit Folgetag-Satz.
 * @param {object} a Artikel @param {{menge:number, tage:number, stunden?:number|null}} w
 * @param {{tag_stunden_standard:number, tag_stunden_erweitert:number, folgetag_prozent:number}} e
 */
export function kalkulatorPosition(a, w, e) {
  const menge = Number(w.menge) || 0, tage = Math.max(1, Number(w.tage) || 1);
  if (a.ist_leistung) {
    const st = w.stunden == null || w.stunden === "" ? e.tag_stunden_standard : Number(w.stunden);
    return { art: "frei", menge, tage, einzelpreis: zeitrechner(st, { tagessatz: a.preis_tag, erweitert: a.preis_erweitert, zeitmodell: a.zeitmodell }, e).summe };
  }
  if (a.verbrauch) return { art: "verkauf", menge, tage: 1, einzelpreis: a.verkaufspreis ?? a.preis_tag };
  return { art: "miete", menge, tage, einzelpreis: a.preis_tag, folgetag_prozent: a.folgetag_prozent ?? e.folgetag_prozent };
}
