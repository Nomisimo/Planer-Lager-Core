// Farbthemen (FA-52, UI-6), Dichten und Kontrastprüfung (UI-7). Rein, ohne DOM – testbar mit node --test.

export const FARBEN_DUNKEL = { DARK: "#1c2127", PANEL: "#252b33", LINE: "#3a424c", BG: "#15191e", OK: "#2ecc71", WARN: "#f39c12",
  ERR: "#ff5d5d", INFO: "#4ea1ff", MUTED: "#8b96a3", SUB: "#9aa4af", TEXT: "#e8eaed", STRONG: "#ffffff", TEXT2: "#c8d0d8",
  INPUT: "#1b2026", CARD: "#1f242b", BTN: "#323a44", LINE2: "#232a33", MID: "#56606c", LINK: "#8ec5ff", HINTBG: "#2a2418",
  DANGERLINE: "#5a2a2a" };
export const FARBEN_HELL = { DARK: "#ffffff", PANEL: "#ffffff", LINE: "#d3d9df", BG: "#eef1f4", OK: "#1a7f45", WARN: "#a35f00",
  ERR: "#c62f2f", INFO: "#1f66b8", MUTED: "#5f6a76", SUB: "#56616d", TEXT: "#1d232a", STRONG: "#10151b", TEXT2: "#38414b",
  INPUT: "#ffffff", CARD: "#f6f8fa", BTN: "#e9edf1", LINE2: "#e5e9ed", MID: "#a5aeb8", LINK: "#1f6fc5", HINTBG: "#fff4dc",
  DANGERLINE: "#e8b4b4" };

/** 8 Themen: tauschen nur den Akzent (UI-STIL). „kontrast“ zusätzlich härtere Linien/Texte. */
export const THEMEN = {
  planer: { titel: "Planer", akzent: "#b3483f" },
  blau: { titel: "Blau", akzent: "#2563c9" },
  gruen: { titel: "Grün", akzent: "#1f7a4d" },
  violett: { titel: "Violett", akzent: "#7048c4" },
  orange: { titel: "Orange", akzent: "#b35400" },
  petrol: { titel: "Petrol", akzent: "#0f6e78" },
  grau: { titel: "Grau", akzent: "#4b5563" },
  kontrast: { titel: "Kontrast hoch", akzent: "#0033cc", kontrast: true },
};
export const DICHTEN = {
  kompakt: { titel: "Kompakt", schrift: 13, abstand: 4, ziel: 30 },
  normal: { titel: "Normal", schrift: 14, abstand: 6, ziel: 34 },
  gross: { titel: "Groß", schrift: 16, abstand: 8, ziel: 44 },
};
export const MODI = { system: "Wie das System", hell: "Hell", dunkel: "Dunkel" };

const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgbHex = (r) => "#" + r.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const luminanz = (h) => { const [r, g, b] = hexRgb(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
/** Kontrastverhältnis nach WCAG 2.x (1…21). */
export function kontrast(a, b) { const x = luminanz(a), y = luminanz(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
/** Mischt Farbe a mit b (t = Anteil b). */
export const mische = (a, b, t) => { const x = hexRgb(a), y = hexRgb(b); return rgbHex(x.map((v, i) => v + (y[i] - v) * t)); };

/** Hellt bzw. dunkelt `farbe` in Richtung `ziel` ab, bis Kontrast zu allen `gegen` ≥ min. */
export function sichereKontrast(farbe, gegen, min = 4.5, ziel = "#ffffff") {
  let f = farbe;
  for (let t = 0; t <= 1.0001; t += 0.04) {
    f = mische(farbe, ziel, t);
    if (gegen.every((g) => kontrast(f, g) >= min)) return f;
  }
  return f;
}

/**
 * Liefert alle CSS-Variablen für Thema + Modus + Dichte.
 * @param {{thema?: string, modus?: "hell"|"dunkel", dichte?: string}} o
 */
export function themaVariablen({ thema = "planer", modus = "dunkel", dichte = "normal" } = {}) {
  const t = THEMEN[thema] || THEMEN.planer;
  const d = DICHTEN[dichte] || DICHTEN.normal;
  const basis = { ...(modus === "hell" ? FARBEN_HELL : FARBEN_DUNKEL) };
  if (t.kontrast) Object.assign(basis, modus === "hell"
    ? { LINE: "#6b7580", TEXT: "#000000", SUB: "#2b333b", MUTED: "#3a434c", TEXT2: "#1b2229" }
    : { LINE: "#8a95a1", TEXT: "#ffffff", SUB: "#d5dbe1", MUTED: "#c0c8d0", TEXT2: "#eef1f4", BG: "#000000", PANEL: "#111418", DARK: "#0b0d10" });
  // Akzent als Fläche: weißer Text darauf muss ≥ 4,5:1 haben → ggf. abdunkeln.
  const akzent = sichereKontrast(t.akzent, ["#ffffff"], 4.5, "#000000");
  // Akzent als Schrift/Linie auf Panel und Hintergrund: im Dunkelmodus aufhellen, im Hellmodus abdunkeln.
  const akzentText = sichereKontrast(t.akzent, [basis.PANEL, basis.BG, basis.DARK, basis.CARD], 4.5, modus === "hell" ? "#000000" : "#ffffff");
  const v = { ...basis, ACCENT: akzent, ACCENT_TEXT: akzentText, ACCENT_HOVER: mische(akzent, "#000000", 0.15),
    ACCENT_SOFT: mische(basis.PANEL, akzent, 0.18), ON_ACCENT: "#ffffff" };
  const css = {};
  for (const [k, w] of Object.entries(v)) css["--lp-" + k.toLowerCase().replace(/_/g, "-")] = w;
  css["--lp-schrift"] = d.schrift + "px";
  css["--lp-abstand"] = d.abstand + "px";
  css["--lp-ziel"] = d.ziel + "px";
  return { farben: v, css };
}

/** Prüfpaare für UI-7 (Vordergrund, Hintergrund, Beschreibung). */
export function kontrastPaare(f) {
  return [
    [f.TEXT, f.BG, "Text auf Hintergrund"], [f.TEXT, f.PANEL, "Text auf Panel"], [f.SUB, f.PANEL, "Nebentext auf Panel"],
    [f.SUB, f.BG, "Nebentext auf Hintergrund"], [f.MUTED, f.PANEL, "gedämpft auf Panel"], [f.ON_ACCENT, f.ACCENT, "Knopftext auf Akzent"],
    [f.ACCENT_TEXT, f.PANEL, "Akzent-Schrift auf Panel"], [f.ACCENT_TEXT, f.DARK, "Logo auf Kopfleiste"], [f.LINK, f.PANEL, "Link auf Panel"],
    [f.ERR, f.PANEL, "Fehlertext auf Panel"], [f.OK, f.PANEL, "OK-Text auf Panel"], [f.WARN, f.PANEL, "Hinweistext auf Panel"],
    [f.INFO, f.PANEL, "Info-Text auf Panel"], [f.TEXT, f.INPUT, "Eingabe"], [f.TEXT, f.BTN, "Text auf Knopf"],
  ];
}

/** UI-7: Schriftfarbe mit dem besseren Kontrast zur Hintergrundfarbe (#rgb/#rrggbb), sonst die übergebene. */
export function badgeSchrift(farbe, text) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(farbe || ""));
  if (!m) return text;
  const h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
  const lin = (i) => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
  const weiss = 1.05 / (L + 0.05), dunkel = (L + 0.05) / (0.0144 + 0.05); // dunkel = #1c2127
  return weiss >= dunkel ? "#ffffff" : "#1c2127";
}
