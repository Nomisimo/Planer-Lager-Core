// Nummernvergabe und Codes (Spec 5.1, 3.6).

const GERAET_RE = /^([A-Za-z]{1,4})[-\s]?0*(\d+)$/;
const PROJEKT_RE = /^([PpJj])[-\s]?(\d{4})[-\s]?0*(\d+)$/;

/** R-22: „lt1“, „LT 1“, „lt-0001“ → „LT-0001“. Alles andere bleibt unverändert (z. B. alte Prüf-ID). */
export function normalisiereCode(eingabe) {
  const s = String(eingabe ?? "").trim();
  const m = GERAET_RE.exec(s);
  if (!m) return s;
  return `${m[1].toUpperCase()}-${m[2].padStart(4, "0")}`;
}
/** Ist das ein Gerätecode-Muster (nach Normalisierung)? */
export const istGeraetecode = (s) => /^[A-Z]{1,4}-\d{4,}$/.test(String(s));

/** R-23: „p2026-1“, „P 2026 001“ → „P-2026-001“; sonst null. */
export function normalisiereProjektcode(eingabe) {
  const m = PROJEKT_RE.exec(String(eingabe ?? "").trim());
  if (!m) return null;
  return `${m[1].toUpperCase()}-${m[2]}-${m[3].padStart(3, "0")}`;
}

/**
 * R-21: nächste Nummer = max(letzte_nummer, höchste vorhandene Nummer des Präfixes) + 1.
 * @param {string} praefix @param {number} letzteNummer @param {string[]} vorhandeneCodes
 * @returns {{code: string, nummer: number}}
 */
export function naechsterGeraetecode(praefix, letzteNummer, vorhandeneCodes = []) {
  const p = praefix.toUpperCase();
  let max = letzteNummer || 0;
  for (const c of vorhandeneCodes) {
    const m = /^([A-Z]{1,4})-(\d+)$/.exec(c);
    if (m && m[1] === p) max = Math.max(max, parseInt(m[2], 10));
  }
  const nummer = max + 1;
  return { code: `${p}-${String(nummer).padStart(4, "0")}`, nummer };
}

/**
 * R-20: P bzw. J + "-" + Jahr + "-" + (höchste vorhandene Nummer dieses Präfixes im Jahr + 1), dreistellig.
 * @param {"P"|"J"} art @param {number} jahr @param {string[]} vorhandene Nummern
 */
export function naechsteProjektnummer(art, jahr, vorhandene = []) {
  let max = 0;
  const re = new RegExp(`^${art}-${jahr}-(\\d+)$`);
  for (const n of vorhandene) { const m = re.exec(n); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `${art}-${jahr}-${String(max + 1).padStart(3, "0")}`;
}

/** 3.6: Präfix-Vorschlag aus dem Kategorienamen (1–4 Buchstaben, eindeutig gegen vorhandene). */
export function praefixVorschlag(name, vorhandene = []) {
  const belegt = new Set(vorhandene.map((p) => p.toUpperCase()));
  const umlaute = String(name || "").replace(/Ä/g, "AE").replace(/Ö/g, "OE").replace(/Ü/g, "UE").replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
  const woerter = umlaute.split(/[^A-Za-z]+/).filter(Boolean);
  const buchst = woerter.join("").toUpperCase();
  const kandidaten = [];
  if (woerter.length > 1) kandidaten.push(woerter.map((w) => w[0]).join("").toUpperCase().slice(0, 4));
  for (const n of [2, 3, 4, 1]) kandidaten.push(buchst.slice(0, n));
  if (buchst.length > 2) for (let i = 1; i < buchst.length; i++) kandidaten.push(buchst[0] + buchst[i]);
  for (const k of kandidaten) if (/^[A-Z]{1,4}$/.test(k) && !belegt.has(k)) return k;
  for (let i = 0; i < 26 * 26; i++) { const k = (buchst[0] || "X") + String.fromCharCode(65 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)); if (!belegt.has(k)) return k; }
  return "";
}
export const praefixGueltig = (p) => /^[A-Z]{1,4}$/.test(String(p));
