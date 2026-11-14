// Geld als Integer-Cent. Kaufmännisch runden (halbe Cent von 0 weg). Nie float für Beträge speichern.

/** Kaufmännisch runden einer (evtl. gebrochenen) Cent-Zahl auf ganze Cent. */
export function rundeCent(x) {
  if (!Number.isFinite(x)) throw new Error("Betrag ungültig");
  // Gegen Gleitkomma-Rauschen (z. B. 0.5000000001) erst auf 6 Nachkommastellen stabilisieren.
  const s = Math.round(Math.abs(x) * 1e6) / 1e6;
  return Math.sign(x) * Math.floor(s + 0.5);
}

/**
 * Cent × Prozent (ganzzahlig oder Hundertstel-Prozent) kaufmännisch gerundet, ohne Float-Fehler.
 * @param {number} cent @param {number} prozent z. B. 50 für 50 %
 */
export const centMalProzent = (cent, prozent) => rundeCent((cent * prozent) / 100);

/** Cent → "1.234,50 €" */
export function euro(cent, { symbol = true } = {}) {
  if (cent == null || cent === "") return "";
  const neg = cent < 0;
  const a = Math.abs(cent);
  const ganz = Math.floor(a / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${neg ? "-" : ""}${ganz},${String(a % 100).padStart(2, "0")}${symbol ? " €" : ""}`;
}

/** "1.234,5" / "12,50 €" / "12.5" → Cent (Integer) oder null bei ungültig. */
export function centAusText(t) {
  if (t == null) return null;
  if (typeof t === "number") return Number.isFinite(t) ? rundeCent(t * 100) : null;
  let s = String(t).replace(/[€\s]/g, "");
  if (!s) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "");
  s = s.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const [g, n = ""] = s.replace("-", "").split(".");
  const cent = parseInt(g, 10) * 100 + parseInt((n + "00").slice(0, 2), 10) + (n.length > 2 && parseInt(n[2], 10) >= 5 ? 1 : 0);
  return s.startsWith("-") ? -cent : cent;
}
