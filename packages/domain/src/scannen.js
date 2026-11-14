// Scannen (Spec 5.5, R-SCAN): reine Hilfen für Level, Texte und Packlisten-Abgleich. Buchung macht der Server.

export const SCAN_MODI = Object.freeze({ hinzufuegen: "Hinzufügen", packen: "Packen", rueckgabe: "Rückgabe" });
const RANG = { ok: 0, warn: 1, error: 2 };

/** Höheres Level gewinnt (ok < warn < error). */
export const hoeher = (a, b) => (RANG[b] > RANG[a] ? b : a);

/** Zielzustand je Modus (Schritt 5). */
export const ZIEL = Object.freeze({
  packen: { status: "gepackt", text: "Gepackt" },
  hinzufuegen: { status: "zugeordnet", text: "Zum Projekt hinzugefügt" },
  rueckgabe: { status: "lager", text: "Zurück im Lager" },
});

/** Schritt 5: Level für übersprungene Ziele – error beim gescannten Gerät selbst, sonst warn. */
export const levelUebersprungen = (istGescannt) => (istGescannt ? "error" : "warn");

/**
 * Schritt 8: Haupttext. „CODE Artikel – Gepackt“ mit Zusatz; nichts gebucht → „nicht gebucht“.
 * @param {{code:string, artikel:string, modus:string, gebucht:number, inhalte:number, istCase:boolean, inhaltOffen?:number, inhaltName?:string}} x
 */
export function scanText(x) {
  if (!x.gebucht) return `${x.code} ${x.artikel} – nicht gebucht`;
  let t = `${x.code} ${x.artikel} – ${ZIEL[x.modus].text}`;
  if (x.modus !== "rueckgabe" && x.inhalte > 0) t += ` (inkl. ${x.inhalte} Inhalte)`;
  if (x.modus === "rueckgabe" && x.istCase && x.inhaltOffen > 0) t += ` – jetzt die ${x.inhaltOffen} Teile${x.inhaltName ? ` (${x.inhaltName})` : ""} darin scannen`;
  return t;
}

/** Schritt 5: Prüfhinweis (nicht bei Rückgabe). */
export function pruefHinweis(code, pruefstatus) {
  if (pruefstatus === "ueberfaellig") return `${code}: Prüfung überfällig!`;
  if (pruefstatus === "offen") return `${code}: Prüfung fehlt!`;
  return null;
}

/**
 * Schritt 6: Case-Prüfungen beim Packen/Hinzufügen.
 * @param {{code:string, soll:number, inhaltArtikelId:number|null}} cs @param {Array<{code:string, artikel_id:number, artikel:string}>} inhalt
 */
export function casePruefung(cs, inhalt) {
  const m = [];
  if (cs.soll > 0 && inhalt.length !== cs.soll) m.push(`Case unvollständig: ${inhalt.length} von ${cs.soll} Teilen eingetragen (${cs.code}).`);
  if (cs.inhaltArtikelId) {
    const falsch = inhalt.filter((g) => g.artikel_id !== cs.inhaltArtikelId);
    if (falsch.length) m.push(`Falscher Inhalt in ${cs.code}: ${falsch.map((g) => `${g.code} (${g.artikel})`).join(", ")}.`);
  }
  return m;
}

/**
 * Schritt 9: Packlisten-Abgleich. zeile = Packlistenzeile des Artikels oder undefined.
 * @param {string} artikel @param {{soll:number}|undefined} zeile @param {number} anzahl gepackt bzw. zugeordnet nach dem Scan
 */
export function packlistenHinweis(artikel, zeile, anzahl, modus) {
  if (!zeile) return `${artikel} steht nicht in der Packliste.`;
  if (anzahl > zeile.soll) return `${artikel}: ${anzahl} ${modus === "packen" ? "gepackt" : "zugeordnet"}, aber nur ${zeile.soll} im Angebot.`;
  return null;
}

/** Fortschritt der Packliste in Prozent (FA-17): Summe min(gepackt, soll) / Summe soll, Verbrauch zählt nicht. */
export function packFortschritt(zeilen) {
  const z = (zeilen || []).filter((x) => !x.verbrauch);
  const soll = z.reduce((s, x) => s + Number(x.soll), 0);
  if (!soll) return 100;
  const fertig = z.reduce((s, x) => s + Math.min(Number(x.gepackt) || 0, Number(x.soll)), 0);
  return Math.floor((fertig * 100) / soll);
}

/**
 * HID-Scanner-Erkennung (ARCHITEKTUR §5): Zeichen mit < schwelleMs Abstand, mindestens minZeichen,
 * Abschluss mit Enter oder Tab. Liefert einen Zustandsautomaten: taste(key, zeitMs) → Code oder null.
 */
export function hidErkenner({ schwelleMs = 35, minZeichen = 4, praefix = "", suffix = "" } = {}) {
  let puffer = "", letzte = 0;
  return {
    taste(key, zeit) {
      if (key === "Enter" || key === "Tab") {
        const p = puffer; const schnell = zeit - letzte < schwelleMs * 4; puffer = "";
        let code = p;
        if (praefix && code.startsWith(praefix)) code = code.slice(praefix.length);
        if (suffix && code.endsWith(suffix)) code = code.slice(0, -suffix.length);
        return code.length >= minZeichen && schnell ? code : null;
      }
      if (key.length !== 1) return null;
      if (puffer && zeit - letzte > schwelleMs) puffer = "";
      puffer += key; letzte = zeit;
      return null;
    },
    get puffer() { return puffer; },
  };
}

/** Einstellungen der Handscanner-Erkennung je Gerät (ARCHITEKTUR §5: Präfix/Suffix und Schwellwerte einstellbar). */
export const HID_STANDARD = Object.freeze({ schwelleMs: 35, minZeichen: 4, praefix: "", suffix: "" });
export function pruefeHid(w) {
  const x = { ...HID_STANDARD, ...(w || {}) };
  const ms = Number(x.schwelleMs), mz = Number(x.minZeichen);
  return { schwelleMs: Number.isInteger(ms) && ms >= 10 && ms <= 200 ? ms : 35, minZeichen: Number.isInteger(mz) && mz >= 2 && mz <= 20 ? mz : 4,
    praefix: String(x.praefix || "").slice(0, 10), suffix: String(x.suffix || "").slice(0, 10) };
}

/** Kamera-Scan: gleicher Code innerhalb der Sperrzeit zählt nur einmal (die Kamera liest etwa 10× pro Sekunde). */
export const KAMERA_WIEDERHOLSPERRE_MS = 2500;
export function neuerTreffer(letzter, code, jetzt) {
  return !(letzter && letzter.code === code && jetzt - letzter.zeit < KAMERA_WIEDERHOLSPERRE_MS);
}
