// Lager-Arbeitsplätze (Spec 2.4, R-11a–g): reine Regeln für Sperre, PIN-Versuche, erlaubte Seiten.

export const STATION_ARTEN = Object.freeze({ packen: "Packen (an einer Ladezone)", rueckgabe: "Rückgabe / Prüfung", anzeige: "Anzeige-Bildschirm (Ladezonen)" });
export const STATION_ROLLE = Object.freeze({ packen: "Lager-Arbeitsplatz", rueckgabe: "Lager-Arbeitsplatz", anzeige: "Anzeige (Bildschirm)" });
export const PIN_MAX_FEHLER = 5;          // R-11c
export const PIN_WARTE_SEKUNDEN = 30;     // R-11c
export const SPERRZEIT_STANDARD = 10;     // R-11b

const ms = (v) => (v ? new Date(v).getTime() : 0);

/** R-11a/R-11b: gesperrt, wenn niemand entsperrt hat oder sperrzeit_minuten ohne Eingabe vergangen sind. Anzeige-Bildschirme sperren nie. */
export function stationGesperrt(ap, jetzt = Date.now()) {
  if (ap.art === "anzeige") return false;
  if (!ap.mitarbeiter_id) return true;
  return jetzt - ms(ap.letzte_aktivitaet) > (Number(ap.sperrzeit_minuten) || SPERRZEIT_STANDARD) * 60_000;
}

/** R-11c: verbleibende Wartezeit in Sekunden (0 = Entsperren erlaubt). */
export const pinWartezeit = (ap, jetzt = Date.now()) => Math.max(0, Math.ceil((ms(ap.gesperrt_bis) - jetzt) / 1000));

/** R-11c: nach einer falschen PIN. 5 in Folge → 30 s Wartezeit, Zähler beginnt danach neu. */
export function nachFehlversuch(fehlversuche, jetzt = Date.now()) {
  const n = (Number(fehlversuche) || 0) + 1;
  if (n >= PIN_MAX_FEHLER) return { fehlversuche: 0, gesperrtBis: new Date(jetzt + PIN_WARTE_SEKUNDEN * 1000), rest: 0 };
  return { fehlversuche: n, gesperrtBis: null, rest: PIN_MAX_FEHLER - n };
}

/**
 * R-11d ERLAUBT-Muster: was ein Arbeitsplatz-Konto aufrufen darf. `sperrfrei` = Sperrbildschirm-Seiten
 * (verlängern die Sperrzeit nicht und gehen auch im gesperrten Zustand, R-11b).
 */
const ERLAUBT = [
  { m: "*", p: /^\/api\/v1\/station(\/.*)?$/, sperrfrei: true },
  { m: "*", p: /^\/api\/v1\/(abmelden|ich|einstellungen\/basis)$/, sperrfrei: true },
  { m: "GET", p: /^\/api\/v1\/anzeige\/zonen$/, sperrfrei: "anzeige" }, // nur der Anzeige-Bildschirm ohne Entsperren
  { m: "POST", p: /^\/api\/v1\/(scan|vermisst|pruefung)$/ },
  { m: "GET", p: /^\/api\/v1\/projekte\/\d+\/(packstatus|rueckgabe|schaeden)$/ },
  { m: "POST", p: /^\/api\/v1\/(schaeden|projekte\/\d+\/schaeden|schaeden\/\d+\/foto)$/ }, // FA-09 Schaden bei Rückgabe
  { m: "GET", p: /^\/api\/v1\/schaeden\/\d+\/foto\/\d+$/ },
  { m: "POST", p: /^\/api\/v1\/projekte\/\d+\/(verladen|packen-oeffnen)$/ },
  { m: "GET", p: /^\/api\/v1\/geraete\/(\d+|code\/[^/]+)$/ },
  { m: "GET", p: /^\/api\/v1\/angebote\/\d+\/(packliste|packliste\.pdf)$/ },
  { m: "GET", p: /^\/api\/v1\/scanner\/auswahl$/ },
];

/** Liefert { erlaubt, sperrfrei } für Methode + Pfad eines Arbeitsplatz-Kontos. Anzeige darf nur die Anzeige. */
export function stationDarf(art, methode, pfad) {
  const r = ERLAUBT.find((e) => (e.m === "*" || e.m === methode) && e.p.test(pfad));
  if (!r) return { erlaubt: false, sperrfrei: false };
  if (art === "anzeige" && !r.sperrfrei) return { erlaubt: false, sperrfrei: false };
  return { erlaubt: true, sperrfrei: r.sperrfrei === true || (r.sperrfrei === "anzeige" && art === "anzeige") };
}

/** FA-25 Eingaben Arbeitsplatz. */
export function pruefeArbeitsplatz(w) {
  const fehler = {};
  const name = String(w?.name ?? "").trim();
  if (!name) fehler.name = "Gib dem Arbeitsplatz einen Namen, z. B. „Packplatz 1“.";
  else if (name.length > 60) fehler.name = "Der Name ist zu lang (höchstens 60 Zeichen).";
  const art = String(w?.art || "packen");
  if (!STATION_ARTEN[art]) fehler.art = "Wähle die Art: Packen, Rückgabe oder Anzeige.";
  const sperr = Number(w?.sperrzeit_minuten ?? SPERRZEIT_STANDARD);
  if (!Number.isInteger(sperr) || sperr < 1 || sperr > 480) fehler.sperrzeit_minuten = "Sperrzeit in ganzen Minuten von 1 bis 480.";
  const zone = w?.ladezone_id === "" || w?.ladezone_id == null ? null : Number(w.ladezone_id);
  if (zone != null && !Number.isInteger(zone)) fehler.ladezone_id = "Wähle eine Ladezone aus der Liste.";
  if (art === "packen" && zone == null) fehler.ladezone_id = "Ein Packplatz gehört zu einer Ladezone. Wähle sie aus. Gibt es noch keine, lege sie zuerst unter Material & Lager → Ladezonen an.";
  return { fehler, werte: { name, art, sperrzeit_minuten: sperr, ladezone_id: art === "packen" ? zone : null,
    funktionstest: art === "rueckgabe" && !!w?.funktionstest, aktiv: w?.aktiv !== false } };
}

/** FA-25 Eingaben Mitarbeiter (kein Benutzerkonto, R-11a). PIN optional, 4–8 Ziffern; pin === undefined = unverändert. */
export function pruefeMitarbeiter(w) {
  const fehler = {};
  const name = String(w?.name ?? "").trim();
  if (!name) fehler.name = "Gib den Namen ein, so wie er am Arbeitsplatz erscheinen soll.";
  else if (name.length > 60) fehler.name = "Der Name ist zu lang (höchstens 60 Zeichen).";
  let pin;
  if (w?.pin !== undefined && w?.pin !== null) {
    pin = String(w.pin).trim();
    if (pin && !/^\d{4,8}$/.test(pin)) fehler.pin = "Die PIN hat 4 bis 8 Ziffern (oder bleibt leer).";
  }
  return { fehler, werte: { name, pin, aktiv: w?.aktiv !== false } };
}
