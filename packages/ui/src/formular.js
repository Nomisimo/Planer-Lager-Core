// UI-4: Speichern nur einmal (Sperre bis Antwort), Pflichtfelder, Fehler je Feld.

/** Erzeugt eine Speicher-Funktion, die während eines laufenden Aufrufs weitere Aufrufe verwirft. */
export function einmalig(fn) {
  let laeuft = null;
  const f = (...a) => {
    if (laeuft) return laeuft;
    // fn sofort (synchron) aufrufen, damit e.stopPropagation()/preventDefault() im Klick noch wirken
    let r;
    try { r = Promise.resolve(fn(...a)); } catch (e) { r = Promise.reject(e); }
    laeuft = r.finally(() => { laeuft = null; });
    return laeuft;
  };
  f.laeuft = () => !!laeuft;
  return f;
}

/**
 * Pflichtfelder prüfen. felder: { name: { pflicht: true, titel: "Name" } }
 * @returns {Record<string,string>} Fehler je Feld
 */
export function pruefePflicht(werte, felder) {
  const f = {};
  for (const [k, d] of Object.entries(felder)) {
    const v = werte?.[k];
    if (d.pflicht && (v == null || (typeof v === "string" && !v.trim()))) f[k] = `${d.titel || k} fehlt. Bitte ausfüllen.`;
  }
  return f;
}

/** Aktionen, die eine Sicherheitsabfrage brauchen (UI-4). */
export const BRAUCHT_BESTAETIGUNG = new Set(["loeschen", "verladen", "wiederherstellen"]);

/* ── GLEICH: Fassungskonflikt (409) ── */
const ALS_TEXT = (v) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
const LOKAL_ZEIT = /^\d{4}-\d\d-\d\dT\d\d:\d\d$/;
const ISO_ZEIT = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:?\d\d)$/;
/** ISO-Zeitpunkt → „JJJJ-MM-TTTHH:MM“ in Europe/Berlin (für datetime-local-Felder). */
export function berlinLokal(iso) {
  const t = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${t.year}-${t.month}-${t.day}T${t.hour}:${t.minute}`;
}
/** Wert aus der aktuellen Fassung in die Form des Formularfelds bringen (Text bleibt Text, Zeitpunkt bleibt lokal). */
function wieFeld(alt, neu) {
  if (typeof alt === "string") {
    if (LOKAL_ZEIT.test(alt) && typeof neu === "string" && ISO_ZEIT.test(neu)) return berlinLokal(neu);
    if (Array.isArray(neu)) return neu.join(", ");
    return neu == null ? "" : String(neu);
  }
  if (typeof alt === "number" && typeof neu === "string" && neu !== "" && !Number.isNaN(Number(neu))) return Number(neu);
  return neu;
}
/** Felder, in denen sich die eigenen Eingaben von der aktuellen Fassung unterscheiden (für „Deine Werte | Aktuelle Werte“). */
export function fassungsUnterschiede(werte, aktuell) {
  if (!werte || !aktuell) return [];
  return Object.keys(werte).filter((k) => k !== "version" && k in aktuell && (typeof werte[k] !== "object" || werte[k] === null)
    && ALS_TEXT(werte[k]) !== ALS_TEXT(wieFeld(werte[k], aktuell[k])))
    .map((k) => ({ feld: k, deine: werte[k], aktuell: wieFeld(werte[k], aktuell[k]) }));
}
/** „Neue Fassung laden“: Formularwerte aus der aktuellen Fassung, gleiche Felder, gleiche Form; Fassung übernehmen. */
export function uebernimmFassung(werte, aktuell) {
  const w = { ...werte };
  for (const k of Object.keys(werte)) if (k in aktuell && (typeof werte[k] !== "object" || werte[k] === null)) w[k] = wieFeld(werte[k], aktuell[k]);
  w.version = aktuell.version;
  return w;
}
/** Feldname lesbar machen: „zuladung_kg“ → „Zuladung kg“. */
export const feldTitel = (k) => (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_id$/, "").replace(/_/g, " ");
