// Eigener Code-128-Encoder (ARCHITEKTUR §7): Zeichensatz B, Ziffernfolgen ≥ 4 in Zeichensatz C (kürzer).
// Ergebnis: Folge von Strich-/Lückenbreiten (Module) bzw. SVG.

// Muster 0..106 (Strich/Lücke abwechselnd, beginnend mit Strich), 106 = Stopp (13 Module).
const MUSTER = ("212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 " +
  "221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 " +
  "231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 " +
  "314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 " +
  "111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 " +
  "114131 311141 411131 211412 211214 211232 2331112").split(" ");
const START_B = 104, START_C = 105, CODE_B = 100, CODE_C = 99, STOPP = 106;

/** Werte (Symbolnummern) inkl. Start, Prüfzeichen, Stopp. Nur ASCII 32–126. */
export function code128Werte(text) {
  const s = String(text);
  if (!s.length) throw new Error("Leerer Barcode");
  for (const ch of s) { const c = ch.charCodeAt(0); if (c < 32 || c > 126) throw new Error(`Zeichen „${ch}“ kann nicht als Barcode gedruckt werden`); }
  const ziffernAb = (i) => { let n = 0; while (i + n < s.length && /\d/.test(s[i + n])) n++; return n; };
  const werte = [];
  let i = 0;
  let satz = ziffernAb(0) >= 4 && ziffernAb(0) === s.length || ziffernAb(0) >= 4 ? "C" : "B";
  werte.push(satz === "C" ? START_C : START_B);
  while (i < s.length) {
    const n = ziffernAb(i);
    if (satz === "B" && n >= 4 && (n >= 6 || i + n === s.length)) { werte.push(CODE_C); satz = "C"; }
    if (satz === "C") {
      if (n >= 2) { werte.push(parseInt(s.substr(i, 2), 10)); i += 2; continue; }
      werte.push(CODE_B); satz = "B";
    }
    werte.push(s.charCodeAt(i) - 32); i++;
  }
  let summe = werte[0];
  for (let k = 1; k < werte.length; k++) summe += werte[k] * k;
  werte.push(summe % 103, STOPP);
  return werte;
}

/** Modulbreiten inkl. Ruhezone (10 Module je Seite). */
export function code128Module(text) {
  const breiten = [];
  for (const w of code128Werte(text)) for (const ch of MUSTER[w]) breiten.push(+ch);
  return breiten;
}

/**
 * SVG-Elemente (Rechtecke) für einen Barcode in einem Kasten (mm).
 * @returns {string} SVG-Fragment
 */
export function code128Svg(text, { x = 0, y = 0, breite, hoehe, farbe = "#000" }) {
  const b = code128Module(text);
  const gesamt = b.reduce((a, v) => a + v, 0) + 20;
  const m = breite / gesamt;
  let pos = x + 10 * m;
  let out = "";
  b.forEach((w, i) => { if (i % 2 === 0) out += `<rect x="${(pos).toFixed(3)}" y="${y}" width="${(w * m).toFixed(3)}" height="${hoehe}" fill="${farbe}"/>`; pos += w * m; });
  return out;
}
export const code128Gesamtmodule = (text) => code128Module(text).reduce((a, v) => a + v, 0) + 20;
