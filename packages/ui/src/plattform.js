// Plattform-Schicht (ARCHITEKTUR §10): einziger Ort, der die Electron-Brücke `window.lagerShell` kennt.
// Gleiche Schnittstelle für die Desktop-App (Electron) und die Browser-Version (vom Lager-Server ausgeliefert).

/* global __APP_VERSION__ */
const bruecke = () => (typeof window !== "undefined" ? window.lagerShell : undefined);
const version = () => { try { return __APP_VERSION__; } catch { return "web"; } };

/** Funktionen, die es nur in der Desktop-App gibt (WEB-08). */
export const NUR_DESKTOP = Object.freeze({
  kiosk: "Arbeitsplatz-Modus (Vollbild)",
  direktdruck: "Direktdruck auf den Etikettendrucker",
  seriell: "Bluetooth-Scanner im seriellen Modus",
  ordner: "Projektordner im Dateimanager öffnen",
  serverAdresse: "Server-Adresse ändern",
});
export const RELEASES_URL = "https://github.com/Nomisimo/Materialplaner/releases";

/** Web: Druckfenster mit Seitengröße der Vorlage (@page) und je Etikett einer Seite, dann window.print() (WEB-04). */
export function webDrucken({ breite_mm, hoehe_mm, titel = "Drucken", seiten = [] } = {}) {
  const b = Number(breite_mm), h = Number(hoehe_mm);
  if (!(b >= 10 && b <= 300 && h >= 5 && h <= 300)) return Promise.resolve({ ok: false, text: "Die Etikettengröße ist ungültig. Prüfe die Vorlage." });
  const w = window.open("", "_blank", "popup,width=480,height=640");
  if (!w) return Promise.resolve({ ok: false, text: "Das Druckfenster wurde blockiert. Erlaube Pop-ups für diese Seite und versuche es erneut." });
  const d = w.document;
  d.title = titel;
  const stil = d.createElement("style");
  stil.textContent = `@page { size: ${b}mm ${h}mm; margin: 0 } html, body { margin: 0; padding: 0 }
    .seite { width: ${b}mm; height: ${h}mm; overflow: hidden; page-break-after: always; break-after: page }
    .seite:last-child { page-break-after: auto; break-after: auto } .seite svg { width: 100%; height: 100% }`;
  d.head.appendChild(stil);
  for (const html of seiten) { const s = d.createElement("div"); s.className = "seite"; s.innerHTML = html; d.body.appendChild(s); }
  w.__seitengroesse = `${b}x${h}`;
  w.focus();
  w.print();
  w.close();
  return Promise.resolve({ ok: true, web: true });
}

export const plattform = {
  get istWeb() { return !bruecke(); },
  /** "token" (Desktop: Token im Schlüsselbund) | "cookie" (Browser: HttpOnly-Sitzungscookie) */
  get anmeldungsArt() { return bruecke() ? "token" : "cookie"; },
  info() {
    const s = bruecke();
    if (s) return s.info();
    const titel = typeof document !== "undefined" ? document.title : "";
    return Promise.resolve({ serverUrl: location.origin, titel, version: version(), web: true, serverFest: true });
  },
  tokenLesen: () => bruecke()?.tokenLesen() ?? Promise.resolve(null),
  tokenSchreiben: (t) => bruecke()?.tokenSchreiben(t) ?? Promise.resolve(true),
  /** Etikettendruck: Desktop druckt die Seite mit Seitengröße (FA-10/14), Browser öffnet ein Druckfenster. */
  drucken: (opt) => (bruecke()?.drucken ? bruecke().drucken(opt) : webDrucken(opt)),
  oeffneExtern(url) {
    const s = bruecke();
    if (s) return s.oeffneExtern(url);
    if (!/^https?:\/\//i.test(String(url))) return Promise.resolve(false);
    window.open(url, "_blank", "noopener");
    return Promise.resolve(true);
  },
  /**
   * Andere App öffnen. Desktop: Deep-Link (mit Handoff-Code). Browser: gleicher Server, Cookie gilt (Pfad /).
   * @param {{appId: string, pfad: string, link?: string, neuerTab?: boolean}} o
   */
  oeffneAndereApp({ appId, pfad, link, neuerTab = false }) {
    const s = bruecke();
    if (s) return s.oeffneExtern(link);
    const ziel = `/${appId}/#${pfad.startsWith("/") ? pfad : `/${pfad}`}`;
    if (neuerTab) window.open(ziel, "_blank"); else location.assign(ziel);
    return Promise.resolve(true);
  },
  /** Deep-Links (Desktop) bzw. Hash-Wechsel (Browser). Liefert Abmelde-Funktion. */
  onDeepLink(cb) {
    const s = bruecke();
    if (s) return s.onDeepLink(cb);
    return () => {};
  },
  bereit: () => bruecke()?.bereit() ?? Promise.resolve([]),
  /** Kann diese Plattform die Funktion? Browser: nichts aus NUR_DESKTOP. */
  kann(funktion) {
    const s = bruecke();
    if (!s) return !(funktion in NUR_DESKTOP);
    if (funktion === "serverAdresse") return !!s.serverSetzen;
    if (funktion === "seriell") return typeof navigator !== "undefined" && !!navigator.serial;
    return true;
  },
  serverSetzen: (url) => bruecke()?.serverSetzen?.(url) ?? Promise.resolve({ ok: false, text: "Nur in der Desktop-App." }),
  onSeriellAuswahl: (cb) => bruecke()?.onSeriellAuswahl?.(cb) ?? (() => {}),
  seriellGewaehlt: (portId) => bruecke()?.seriellGewaehlt?.(portId) ?? Promise.resolve(false),
};
