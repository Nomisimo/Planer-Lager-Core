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
