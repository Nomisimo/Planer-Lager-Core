// Etiketten (Spec 3.13, FA-10/11, R-67–R-70): Vorlagen, Darstellung als SVG, Bestellnummern, Lieferabgleich.
import { code128Svg } from "./barcode.js";
import { laengeText } from "./kabel.js";

export const ELEMENT_TYPEN = { qr: "QR-Code", code: "Code (Text)", name: "Artikelname", kategorie: "Kategorie", logo: "Logo", firma: "Firma", farbe: "Farbfeld mit Länge", text: "Freier Text", barcode: "Barcode (Code 128)" };

/** Standardvorlage 62 × 29 mm (Brother-Endlos). */
export const STANDARD_VORLAGE = {
  name: "Standard 62×29", breite_mm: 62, hoehe_mm: 29, farbe: "#ffffff", standard: true,
  elemente: [
    { typ: "qr", x: 2, y: 2, b: 25, h: 25, dreh: 0 },
    { typ: "code", x: 29, y: 3, b: 31, h: 7, dreh: 0, groesse: 5 },
    { typ: "name", x: 29, y: 12, b: 31, h: 6, dreh: 0, groesse: 3 },
    { typ: "kategorie", x: 29, y: 19, b: 31, h: 4, dreh: 0, groesse: 2.4 },
    { typ: "farbe", x: 29, y: 23.5, b: 31, h: 4.5, dreh: 0, groesse: 3 },
  ],
};
export const KABEL_VORLAGE = {
  name: "Kabel 62×29", breite_mm: 62, hoehe_mm: 29, farbe: "#ffffff", standard: false,
  elemente: [
    { typ: "barcode", x: 2, y: 2, b: 58, h: 12, dreh: 0 },
    { typ: "code", x: 2, y: 15, b: 30, h: 6, dreh: 0, groesse: 4 },
    { typ: "farbe", x: 33, y: 15, b: 27, h: 12, dreh: 0, groesse: 6 },
    { typ: "name", x: 2, y: 22, b: 30, h: 5, dreh: 0, groesse: 2.6 },
  ],
};

export const BEISPIEL = { code: "LT-0001", name: "Schuko-Kabel 5 m", kategorie: "Stromkabel", firma: "Verleih GmbH", laenge_m: 5, farbe_hex: "#1e66d0", text: "" };

/** Prüft eine Vorlage. @returns Fehler je Feld */
export function pruefeVorlage(v) {
  const f = {};
  if (!String(v.name || "").trim()) f.name = "Name fehlt. Bitte ausfüllen.";
  if (!(v.breite_mm >= 10 && v.breite_mm <= 300)) f.breite_mm = "Breite: 10 bis 300 mm.";
  if (!(v.hoehe_mm >= 5 && v.hoehe_mm <= 300)) f.hoehe_mm = "Höhe: 5 bis 300 mm.";
  if (!Array.isArray(v.elemente)) f.elemente = "Die Vorlage hat keine Elemente.";
  else for (const e of v.elemente) {
    if (!ELEMENT_TYPEN[e.typ]) { f.elemente = `Unbekannter Elementtyp „${e.typ}“.`; break; }
    if (![e.x, e.y, e.b, e.h].every((n) => typeof n === "number" && isFinite(n)) || e.b <= 0 || e.h <= 0) { f.elemente = "Ein Element hat ungültige Maße."; break; }
  }
  return f;
}

/** Rastet einen mm-Wert auf das Raster ein (FA-11 Snap). */
export const snap = (v, raster = 0.5) => Math.round(v / raster) * raster;

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Helle oder dunkle Schrift auf einer Farbe. */
function schriftAuf(hex) {
  const n = parseInt(String(hex || "#ffffff").slice(1), 16);
  const l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.6 ? "#000" : "#fff";
}

/**
 * Ein Etikett als SVG (Einheit mm).
 * @param {object} vorlage
 * @param {{code, name, kategorie, firma, laenge_m, farbe_hex, text, qr?: boolean[][], logo?: string}} d
 */
export function etikettSvg(vorlage, d) {
  const W = vorlage.breite_mm, H = vorlage.hoehe_mm;
  let inhalt = `<rect width="${W}" height="${H}" fill="${esc(vorlage.farbe || "#fff")}"/>`;
  for (const e of vorlage.elemente || []) {
    const cx = e.x + e.b / 2, cy = e.y + e.h / 2;
    const tr = e.dreh ? ` transform="rotate(${e.dreh} ${cx} ${cy})"` : "";
    const gr = e.groesse || Math.min(e.h * 0.8, 5);
    const text = (t, extra = "") => `<text x="${cx}" y="${cy}" font-size="${gr}" font-family="Helvetica, Arial, sans-serif" text-anchor="middle" dominant-baseline="central"${extra}${tr}>${esc(t)}</text>`;
    switch (e.typ) {
      case "qr": {
        const m = d.qr;
        if (!m?.length) { inhalt += `<rect x="${e.x}" y="${e.y}" width="${e.b}" height="${e.h}" fill="none" stroke="#000" stroke-width="0.2"${tr}/>`; break; }
        const n = m.length, s = Math.min(e.b, e.h) / n;
        let p = "";
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) p += `M${(e.x + c * s).toFixed(3)} ${(e.y + r * s).toFixed(3)}h${s.toFixed(3)}v${s.toFixed(3)}h-${s.toFixed(3)}z`;
        inhalt += `<path d="${p}" fill="#000"${tr}/>`;
        break;
      }
      case "barcode": inhalt += `<g${tr}>${code128Svg(d.code, { x: e.x, y: e.y, breite: e.b, hoehe: e.h })}</g>`; break;
      case "code": inhalt += text(d.code, ' font-weight="bold"'); break;
      case "name": inhalt += text(d.name); break;
      case "kategorie": inhalt += text(d.kategorie); break;
      case "firma": inhalt += text(d.firma); break;
      case "text": inhalt += text(e.text || d.text || ""); break;
      case "logo": inhalt += d.logo ? `<image href="${esc(d.logo)}" x="${e.x}" y="${e.y}" width="${e.b}" height="${e.h}" preserveAspectRatio="xMidYMid meet"${tr}/>` : ""; break;
      case "farbe": // 5.4: Länge auf Farbfeld, nie Farbname
        if (d.laenge_m == null) break;
        inhalt += `<rect x="${e.x}" y="${e.y}" width="${e.b}" height="${e.h}" rx="0.6" fill="${esc(d.farbe_hex || "#fff")}" stroke="#000" stroke-width="0.2"${tr}/>`;
        inhalt += text(laengeText(d.laenge_m), ` font-weight="bold" fill="${schriftAuf(d.farbe_hex)}"`);
        break;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">${inhalt}</svg>`;
}

/** EB-JJJJ-NNN (3.13). */
export function naechsteBestellnummer(jahr, vorhandene = []) {
  let max = 0;
  for (const n of vorhandene) { const m = new RegExp(`^EB-${jahr}-(\\d+)$`).exec(n); if (m) max = Math.max(max, +m[1]); }
  return `EB-${jahr}-${String(max + 1).padStart(3, "0")}`;
}

/** Status 3.13/4.4 aus gelieferten Codes. */
export const bestellStatus = (gesamt, geliefert) => (geliefert === 0 ? "offen" : geliefert < gesamt ? "teilweise" : "geliefert");

/** R-69: Abgleich ohne Groß-/Kleinschreibung und Bindestrich. */
export const lieferSchluessel = (code) => String(code || "").toUpperCase().replace(/[-\s]/g, "");

/** R-68: CSV-Code „ohne Bindestrich“. */
export const csvCode = (code, ohneBindestrich) => (ohneBindestrich ? String(code).replace(/-/g, "") : String(code));

/** R-67: Positionen prüfen. artikel: Map id→{verbrauch, ist_leistung, praefix, name} */
export function pruefeBestellung(positionen, artikel) {
  if (!Array.isArray(positionen) || !positionen.length) return "Füge mindestens eine Position hinzu.";
  for (const p of positionen) {
    const a = artikel.get(p.artikel_id);
    if (!a) return "Ein Artikel der Bestellung existiert nicht mehr. Lade die Seite neu.";
    if (!Number.isInteger(p.menge) || p.menge < 1 || p.menge > 500) return `Menge für „${a.name}“ muss zwischen 1 und 500 liegen.`;
    if (a.verbrauch || a.ist_leistung) return `„${a.name}“ ist Verbrauch oder Leistung und bekommt keine Etiketten. Wähle einen Artikel mit Einzelgeräten.`;
    if (!a.praefix) return `Die Kategorie von „${a.name}“ hat kein Kürzel. Lege zuerst ein Präfix fest.`;
  }
  return null;
}
