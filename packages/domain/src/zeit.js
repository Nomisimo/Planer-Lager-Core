// Datum/Zeit in Europe/Berlin, Anzeige TT.MM.JJJJ.
const TZ = "Europe/Berlin";
const fmtDatum = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const fmtZeit = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const fmtIso = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** "2026-11-14" oder Date → "14.11.2026" */
export function datumAnzeige(d) {
  if (d == null || d === "") return "";
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) { const [y, m, t] = d.split("-"); return `${t}.${m}.${y}`; }
  return fmtDatum.format(new Date(d));
}
/** Date → "14.11.2026 09:30" */
export const zeitpunktAnzeige = (d) => (d ? `${fmtDatum.format(new Date(d))} ${fmtZeit.format(new Date(d))}` : "");
/** Kalendertag in Berlin als "JJJJ-MM-TT". */
export const heuteIso = (jetzt = new Date()) => fmtIso.format(jetzt);
/** "14.11.2026" → "2026-11-14" (null bei ungültig). */
export function datumEingabe(s) {
  const m = /^\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*$/.exec(String(s || ""));
  if (!m) return /^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? String(s) : null;
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(iso + "T12:00:00Z");
  return d.toISOString().slice(0, 10) === iso ? iso : null;
}
