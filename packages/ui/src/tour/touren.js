// Einführungs-Touren als Daten (ARCHITEKTUR §11, ZUSATZ Phase 18). Keine Seiteneffekte: nur Navigation und Hinweise.
// Schritt: { anker (= data-tour), titel, text, art: "weiter" | "klick" | "eingabe", vor (Pfad, vorher öffnen),
//           recht ([bereich, stufe] – sonst ausgelassen), admin (nur für Admins), nurDesktop, nurWeb }

const kopf = [
  { anker: "menue", titel: "Das Menü", text: "Links findest du alles nach Arbeitsablauf sortiert. Einträge mit Pfeil öffnen die andere App an der passenden Stelle." },
  { anker: "codefeld", titel: "Codefeld", text: "Gerätecode, Projekt- oder Angebotsnummer eintippen oder scannen und Enter drücken – die passende Seite öffnet sich, auch in der anderen App." },
];
const schluss = [
  { anker: "verwaltung", vor: "/verwaltung", admin: true, titel: "Verwaltung (nur Admins)", text: "Benutzer, Rollen, Einstellungen, Sicherung, Sicherheit, Arbeitsplätze und Scanner richtest du hier ein." },
  { anker: "hilfe-touren", vor: "/hilfe", titel: "Hilfe", text: "Hier startest du jede Tour noch einmal und findest Tastenkürzel und eine Kurzanleitung. Viel Erfolg!" },
];

/** @type {{ id: string, app: "m" | "p" | "beide" | "station", titel: string, text: string, schritte: object[] }[]} */
export const TOUREN = [
  {
    id: "materialplaner", app: "m", titel: "Materialplaner kennenlernen",
    text: "Material, Geräte, Etiketten, Scannen und Packen – in 8 Schritten.",
    schritte: [
      ...kopf,
      { anker: "material-aufnehmen", vor: "/material", recht: ["material", "w"], titel: "Material aufnehmen", text: "Neue Artikel legst du hier an. Mit Anzahl und Kennzeichnung „QR“ entstehen die Geräte samt Etiketten gleich mit." },
      { anker: "geraete", vor: "/geraete", recht: ["geraete", "r"], titel: "Geräte", text: "Jedes Gerät mit Code, Status, Lagerort und Prüfdatum. Filter oben, Klick auf eine Zeile öffnet den Verlauf." },
      { anker: "menue-/scan", recht: ["packen", "r"], art: "klick", titel: "Scannen", text: "Klick auf „Code scannen“. Dort packst du Projekte und nimmst Rückgaben an." },
      { anker: "scanfeld", vor: "/scan", recht: ["packen", "r"], titel: "Scanfeld", text: "Projekt wählen und scannen – der Handscanner tippt den Code hier ein. Grün = gebucht, gelb = Hinweis, rot = nicht gebucht." },
      ...schluss,
    ],
  },
  {
    id: "productionplaner", app: "p", titel: "Productionplaner kennenlernen",
    text: "Kunden, Projekte, Kalender, Angebote und Planungszeit – in 8 Schritten.",
    schritte: [
      ...kopf,
      { anker: "projekt-neu", vor: "/projekte", recht: ["projekte", "w"], titel: "Projekte", text: "Hier legst du Projekte an. Jobs je Gewerk hängen am Projekt und übernehmen Kunde und Termin." },
      { anker: "kalender", vor: "/kalender", recht: ["projekte", "r"], titel: "Kalender", text: "Alle Projekte als Balken nach Status. Klick auf einen Balken öffnet das Projekt." },
      { anker: "angebote", vor: "/angebote", recht: ["angebote", "r"], titel: "Angebote", text: "Angebote mit Verfügbarkeit, Preisen und Fassungen. Angenommen heißt: Material fest reserviert, das Lager kann packen." },
      { anker: "planungszeit", vor: "/zeiterfassung", recht: ["zeiten", "r"], titel: "Planungszeit", text: "Der Timer am Projekt zählt mit, solange du daran planst. Hier siehst du die Auswertung und buchst nach." },
      ...schluss,
    ],
  },
  {
    id: "zusammenspiel", app: "beide", titel: "Zusammenspiel der beiden Apps",
    text: "Wechsel zwischen Materialplaner und Productionplaner, Browser und Desktop, Live-Stand.",
    schritte: [
      { anker: "app-schalter", titel: "App wechseln", text: "Ein Klick öffnet die andere App an der passenden Stelle – ohne neue Anmeldung." },
      { anker: "im-browser", nurDesktop: true, titel: "Im Browser öffnen", text: "Dieselbe Ansicht im Browser, z. B. am Tablet im Lager. Die Anmeldung wird mitgenommen." },
      { anker: "in-desktop", nurWeb: true, titel: "In der Desktop-App öffnen", text: "Öffnet diese Ansicht in der installierten App, ohne neue Anmeldung." },
      { anker: "online-status", titel: "Live-Verbindung", text: "Solange hier „Online“ steht, siehst du Änderungen der Kollegen sofort, ohne neu zu laden." },
      { anker: "glocke", titel: "Benachrichtigungen", text: "Fällige Aufgaben und Hinweise aus beiden Apps landen hier." },
      { anker: "benutzer", titel: "Ein Konto für alles", text: "Du bist in beiden Apps mit demselben Konto angemeldet; Rechte gelten überall gleich." },
    ],
  },
  {
    id: "arbeitsplatz", app: "station", titel: "Arbeitsplatz im Lager",
    text: "Kurz erklärt: entsperren, scannen, sperren.",
    schritte: [
      { anker: "station-mitarbeiter", titel: "Wer arbeitet hier?", text: "Oben steht, wer gerade angemeldet ist. Zum Wechseln sperren und mit der eigenen PIN entsperren." },
      { anker: "scanfeld", titel: "Scannen", text: "Der Handscanner tippt hier ein. Das Ergebnis erscheint groß und farbig darunter." },
      { anker: "station-sperren", titel: "Sperren", text: "Beim Weggehen sperren. Nach einiger Zeit ohne Scan sperrt der Platz von selbst." },
    ],
  },
];

/**
 * Schritte einer Tour für Nutzer und Plattform (TOUR-03: keine Admin-Schritte für andere Rollen).
 * @param {{ schritte: object[] }} tour @param {{ admin?: boolean, rechte?: Record<string,string> }} nutzer @param {boolean} web
 */
export function schritteFuer(tour, nutzer, web, darf) {
  return tour.schritte.filter((s) => (!s.admin || nutzer?.admin)
    && (!s.recht || nutzer?.admin || darf(nutzer?.rechte || {}, s.recht[0], s.recht[1]))
    && !(s.nurDesktop && web) && !(s.nurWeb && !web));
}

/** Touren, die in einer App angeboten werden. @param {"m"|"p"|"station"} app */
export const tourenFuer = (app) => TOUREN.filter((t) => t.app === app || (t.app === "beide" && app !== "station"));

/** Alle Anker (TOUR-07). */
export const alleAnker = () => [...new Set(TOUREN.flatMap((t) => t.schritte.map((s) => s.anker)))];
