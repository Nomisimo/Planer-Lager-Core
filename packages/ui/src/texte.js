// UI-2 Rückmeldung und UI-5 Textregeln als Hilfsfunktionen.

/** UI-2: Stufe → Farbe-Variable, Symbol und Kurztext (Farbe nie allein). */
export const RUECKMELDUNG = {
  success: { farbe: "var(--lp-ok)", symbol: "✓", icon: "CheckCircle2", wort: "Erledigt" },
  warning: { farbe: "var(--lp-warn)", symbol: "▲", icon: "AlertTriangle", wort: "Erledigt mit Hinweis" },
  error: { farbe: "var(--lp-err)", symbol: "✕", icon: "XCircle", wort: "Nicht erledigt" },
  info: { farbe: "var(--lp-info)", symbol: "i", icon: "Info", wort: "Hinweis" },
};
export const stufeVon = (level) => (RUECKMELDUNG[level] ? level : level === "ok" ? "success" : level === "warn" ? "warning" : "error");

const FACHJARGON = /\b(Exception|Error|null|undefined|NaN|HTTP|JSON|API|SQL|Stacktrace|Timeout|Request|Response|Server Error|ECONNREFUSED|fetch)\b/i;
const SIE_FORM = /\b(Sie|Ihnen|Ihr|Ihre|Ihren|Ihrem|Ihrer|Bitte geben Sie)\b/;

/**
 * UI-5: prüft einen Fehlertext. Ursache + nächster Schritt = mindestens zwei Sätze bzw. ein Satz mit Handlungsaufforderung.
 * @returns {string[]} Verstöße (leer = in Ordnung)
 */
export function pruefeFehlertext(t) {
  const v = [];
  const s = String(t || "").trim();
  if (!s) return ["leer"];
  if (SIE_FORM.test(s)) v.push("Sie-Form statt Du-Form");
  if (FACHJARGON.test(s)) v.push("Fachjargon");
  const saetze = s.split(/(?<=[.!?])\s+/).filter(Boolean);
  const schritt = /(\b(prüf|versuch|lade|wähl|gib|melde|warte|nimm|richte|scanne|öffne|ernenne|weise|klick|tipp|frag|wende|leg|trag|ändere|korrigier|nutze|schließ|bestätig|starte|verbinde)\w*|bitte)\b/i;
  if (saetze.length < 2 && !schritt.test(s)) v.push("kein nächster Schritt");
  return v;
}

/** Übersetzt technische Fehler (Netz, 5xx) in UI-5-Text. */
export function fehlerText(e) {
  if (e && typeof e === "object" && e.text) return e.text;
  if (e && typeof e === "object" && e.fehler) return e.fehler;
  if (e?.name === "TypeError" || /Failed to fetch|NetworkError|ECONNREFUSED/i.test(String(e?.message)))
    return "Keine Verbindung zum Lager-Server. Prüfe die Internetverbindung und versuche es erneut.";
  return "Das hat nicht geklappt. Versuche es noch einmal oder melde es dem Admin.";
}
