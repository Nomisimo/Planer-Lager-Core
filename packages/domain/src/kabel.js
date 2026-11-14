// Kabel (Spec 3.12, 5.4): Länge aus Name (R-29), feste Farbe je Länge (R-29a).
import { rundeCent } from "./geld.js";

/** 12 Farben in fester Reihenfolge (3.12). */
export const KABELFARBEN = [
  { name: "Rot", hex: "#e53935" }, { name: "Blau", hex: "#1e66d0" }, { name: "Grün", hex: "#2e9d47" }, { name: "Gelb", hex: "#fdd835" },
  { name: "Orange", hex: "#fb8c00" }, { name: "Weiß", hex: "#ffffff" }, { name: "Schwarz", hex: "#111111" }, { name: "Violett", hex: "#7b3fbf" },
  { name: "Grau", hex: "#8a8f96" }, { name: "Braun", hex: "#7a4a24" }, { name: "Rosa", hex: "#f48fb1" }, { name: "Türkis", hex: "#1ec8c8" },
];
export const farbeHex = (name) => KABELFARBEN.find((f) => f.name === name)?.hex || null;

// R-29: (?<![\w.,])(\d{1,3}(?:[.,]\d{1,2})?)\s*(m|meter|cm)(?![Buchstabe])
const LAENGE_RE = /(?<![\p{L}\p{N}_.,])(\d{1,3}(?:[.,]\d{1,2})?)\s*(m|meter|cm)(?!\p{L})/giu;

/**
 * Länge in m aus dem Artikelnamen. Letzter Treffer zählt; cm / 100; nur in Kategorien mit „kabel“ im Namen.
 * @returns {number|null}
 */
export function laengeAusName(name, kategorieName) {
  if (!/kabel/i.test(String(kategorieName || ""))) return null;
  let letzte = null;
  for (const m of String(name || "").matchAll(LAENGE_RE)) letzte = m;
  if (!letzte) return null;
  let wert = parseFloat(letzte[1].replace(",", "."));
  if (letzte[2].toLowerCase() === "cm") wert /= 100;
  return Math.round(wert * 100) / 100;
}

/** R-29a: nächste freie Farbe (oder null, wenn alle 12 vergeben). */
export function naechsteFreieFarbe(vergeben) {
  const belegt = new Set(vergeben);
  return KABELFARBEN.find((f) => !belegt.has(f.name))?.name || null;
}

/** Länge als Anzeige: 7.5 → „7,5 m“. */
export const laengeText = (m) => (m == null ? "" : `${String(Number(m)).replace(".", ",")} m`);

/** R-73: Standardlängen im Kabel-Assistenten. */
export const STANDARD_LAENGEN = [0.5, 1, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 50];
/** R-73: Name je Länge. */
export const kabelName = (art, laenge) => `${String(art).trim()} ${String(laenge).replace(".", ",")} m`;

/** R-73: Zeilenpreis = Länge × Meterpreis (Cent, kaufmännisch gerundet). */
export const zeilenpreis = (laenge, meterpreisCent) => (meterpreisCent == null || meterpreisCent === "" ? null : rundeCent(Number(laenge) * Number(meterpreisCent)));
