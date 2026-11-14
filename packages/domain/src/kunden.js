// Kunden (3.1, FA-26, FA-27): Prüfung und Dublettenerkennung.
import { aehnlichkeit } from "./passwort.js";

export const KUNDE_FELDER = ["name", "firma", "email", "telefon", "strasse", "plz", "ort", "ust_id", "notizen"];

export function pruefeKunde(k) {
  const f = {};
  if (!String(k.name || "").trim()) f.name = "Der Name des Ansprechpartners fehlt. Bitte ausfüllen.";
  if (k.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(k.email).trim())) f.email = "Die E-Mail-Adresse sieht unvollständig aus. Prüfe sie.";
  if (k.plz && !/^[0-9A-Za-z -]{3,10}$/.test(String(k.plz).trim())) f.plz = "Die PLZ sieht ungültig aus. Prüfe sie.";
  return f;
}

const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\b(gmbh|ag|kg|ug|e\.?\s?v|ohg|gbr|co)\b/g, "").replace(/[^a-z0-9]/g, "");
const ziffern = (s) => { let d = String(s || "").replace(/\D/g, ""); if (d.startsWith("49")) d = "0" + d.slice(2); if (d.startsWith("0049")) d = "0" + d.slice(4); return d; };

/**
 * Mögliche Dubletten zu einem neuen Kunden, mit Grund. Treffer, wenn E-Mail oder Telefon gleich,
 * Firma gleich (ohne Rechtsform) oder Name sehr ähnlich bei gleichem Ort/gleicher PLZ.
 * @returns {{kunde: object, gruende: string[]}[]}
 */
export function dubletten(neu, vorhandene) {
  const out = [];
  for (const k of vorhandene) {
    const g = [];
    if (neu.email && k.email && neu.email.trim().toLowerCase() === k.email.trim().toLowerCase()) g.push("gleiche E-Mail");
    const tn = ziffern(neu.telefon), tk = ziffern(k.telefon);
    if (tn.length >= 6 && tn === tk) g.push("gleiche Telefonnummer");
    if (norm(neu.firma) && norm(neu.firma) === norm(k.firma)) g.push("gleiche Firma");
    const gleicherOrt = (neu.plz && neu.plz === k.plz) || (neu.ort && norm(neu.ort) === norm(k.ort));
    if (aehnlichkeit(norm(neu.name), norm(k.name)) >= 0.85 && (gleicherOrt || (!neu.ort && !neu.plz))) g.push("ähnlicher Name");
    if (g.length) out.push({ kunde: k, gruende: g });
  }
  return out.sort((a, b) => b.gruende.length - a.gruende.length);
}
