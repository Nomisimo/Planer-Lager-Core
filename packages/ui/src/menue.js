// Seitenmenü (UI-1): nach Arbeitsablauf gruppiert, nur erlaubte Einträge, aktiver Eintrag nach längstem Präfix.
import { darf } from "@lager/domain/rechte.js";

/** app = zuständige App ("m" Materialplaner, "p" Productionplaner, "beide"). */
export const MENUE = [
  { gruppe: "Start", eintraege: [
    { titel: "Übersicht", pfad: "/", bereich: "start", app: "beide", icon: "Home" },
    { titel: "Suche", pfad: "/suche", bereich: "start", app: "beide", icon: "Search" },
  ] },
  { gruppe: "Aufträge", eintraege: [
    { titel: "Kunden", pfad: "/kunden", bereich: "kunden", app: "p", icon: "Users" },
    { titel: "Projekte", pfad: "/projekte", bereich: "projekte", app: "p", icon: "FolderKanban" },
    { titel: "Kalender", pfad: "/kalender", bereich: "projekte", app: "p", icon: "CalendarDays" },
    { titel: "Aufgaben", pfad: "/aufgaben", bereich: "projekte", app: "p", icon: "ListChecks" },
    { titel: "Angebote", pfad: "/angebote", bereich: "angebote", app: "p", icon: "FileText" },
    { titel: "Planungszeit", pfad: "/zeiterfassung", bereich: "zeiten", app: "p", icon: "Timer" },
    { titel: "Personal", pfad: "/personal", bereich: "projekte", app: "p", icon: "UserCog" },
    { titel: "Fahrzeuge", pfad: "/fahrzeuge", bereich: "projekte", app: "p", icon: "Truck" },
  ] },
  { gruppe: "Material & Lager", eintraege: [
    { titel: "Material", pfad: "/material", bereich: "material", app: "m", icon: "Package" },
    { titel: "Geräte", pfad: "/geraete", bereich: "geraete", app: "m", icon: "Boxes" },
    { titel: "Etiketten", pfad: "/etiketten", bereich: "material", app: "m", icon: "Tags" },
    { titel: "Plan-Symbole", pfad: "/plansymbole", bereich: "material", app: "m", icon: "Shapes" },
    { titel: "Ladezonen", pfad: "/zonen", bereich: "zonen", app: "m", icon: "LayoutGrid" },
    { titel: "Code scannen", pfad: "/scan", bereich: "packen", app: "m", icon: "ScanLine", auch: [/^\/projekte\/\d+\/(packen|rueckgabe)$/] },
    { titel: "Inventur", pfad: "/inventur", bereich: "geraete", app: "m", icon: "ClipboardList" },
    { titel: "Reparatur", pfad: "/reparatur", bereich: "geraete", app: "m", icon: "Wrench" },
  ] },
  { gruppe: "Kalkulation", eintraege: [
    { titel: "Kalkulator", pfad: "/kalkulator", bereich: "angebote", app: "p", icon: "Calculator" },
    { titel: "Zeitrechner", pfad: "/zeitrechner", bereich: "zeitrechner", app: "p", icon: "Clock" },
  ] },
  { gruppe: "System", eintraege: [
    { titel: "Verwaltung", pfad: "/verwaltung", bereich: "verwaltung", app: "beide", icon: "Settings" },
  ] },
];

/**
 * Menü für Rolle und App. Einträge der anderen App bleiben sichtbar (Sprung per Deep-Link), sind aber markiert.
 * Gruppen ohne erlaubte Einträge entfallen.
 * @param {Record<string,string>} rechte @param {"m"|"p"} app
 */
export function menueFuer(rechte, app) {
  return MENUE.map((g) => ({
    gruppe: g.gruppe,
    eintraege: g.eintraege.filter((e) => darf(rechte, e.bereich, "r")).map((e) => ({ ...e, fremd: e.app !== "beide" && e.app !== app })),
  })).filter((g) => g.eintraege.length);
}

/** UI-1: aktiver Eintrag = längstes passendes Pfadpräfix. „/“ passt nur exakt. */
export function aktiverEintrag(pfad, eintraege) {
  let best = null;
  for (const e of eintraege) {
    // Zusatzmuster (z. B. Packansicht gehört zu „Code scannen“) schlagen jeden Präfix.
    if (e.auch?.some((r) => r.test(pfad))) return e;
    const passt = e.pfad === "/" ? pfad === "/" : pfad === e.pfad || pfad.startsWith(e.pfad.endsWith("/") ? e.pfad : e.pfad + "/");
    if (passt && (!best || e.pfad.length > best.pfad.length)) best = e;
  }
  return best;
}
