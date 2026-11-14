// Rollen und Rechte (Spec 2.1, 2.2). Stufen: "" kein Zugriff, "r" ansehen, "w" ändern (w schließt r ein).

export const BEREICHE = Object.freeze(["kunden", "projekte", "angebote", "rechnungen", "ausgaben", "auswertung", "material",
  "geraete", "packen", "zeitrechner", "zeiten", "zonen", "anzeige", "verwaltung"]);
/** Bereich `start`: jeder angemeldete Nutzer (D-17). */
export const BEREICH_START = "start";

const alle = (stufe) => Object.fromEntries(BEREICHE.map((b) => [b, stufe]));

/** Eingebaute Rollen (nicht löschbar, R-06). */
export const EINGEBAUTE_ROLLEN = Object.freeze([
  { name: "Administrator", rechte: alle("w") },
  { name: "Büro / Disposition", rechte: { kunden: "w", projekte: "w", angebote: "w", packen: "w", zeiten: "w", zeitrechner: "w",
    rechnungen: "r", material: "r", geraete: "r", zonen: "r" } },
  { name: "Lagerleitung", rechte: { material: "w", geraete: "w", packen: "w", projekte: "r", angebote: "r", kunden: "r", zonen: "r", zeitrechner: "r" } },
  { name: "Lager / Techniker", rechte: { packen: "w", geraete: "r", material: "r", projekte: "r", zonen: "r" } },
  { name: "Lager-Arbeitsplatz", rechte: { packen: "w", geraete: "r" } },
  { name: "Anzeige (Bildschirm)", rechte: { anzeige: "r" } },
]);
export const ROLLE_ADMIN = "Administrator";
export const ROLLE_ARBEITSPLATZ = "Lager-Arbeitsplatz";
export const ROLLE_ANZEIGE = "Anzeige (Bildschirm)";

/** Bereinigt ein Rechte-Objekt: nur bekannte Bereiche, nur "", "r", "w". */
export function normalisiereRechte(rechte) {
  const out = {};
  for (const b of BEREICHE) {
    const s = rechte?.[b];
    out[b] = s === "w" || s === "r" ? s : "";
  }
  return out;
}

/** Ist die Rolle eine Administrator-Rolle? (Bereich verwaltung mit w; R-03) */
export const istAdminRechte = (rechte) => rechte?.verwaltung === "w";

/**
 * Darf eine Rolle im Bereich mit Stufe zugreifen?
 * @param {Record<string,string>} rechte @param {string|null} bereich @param {"r"|"w"} stufe
 */
export function darf(rechte, bereich, stufe) {
  if (istAdminRechte(rechte)) return true;
  if (bereich === BEREICH_START) return true;
  if (!bereich) return false; // R-01: ohne Bereich nur Admin
  if (bereich === "verwaltung") return false; // R-03
  const s = rechte?.[bereich] || "";
  return stufe === "r" ? s === "r" || s === "w" : s === "w";
}

const FORMULAR_SEITE = /\/(neu|bearbeiten|loeschen|importieren|hochladen|pruefen)\/?$/;
/**
 * R-02: GET braucht r; alles andere sowie GET auf Formularseiten braucht w.
 * @param {string} methode @param {string} pfad
 */
export function noetigeStufe(methode, pfad) {
  if (methode === "GET" || methode === "HEAD") return FORMULAR_SEITE.test(pfad) ? "w" : "r";
  return "w";
}

/**
 * R-07: Wäre nach der Änderung noch mindestens ein aktiver Administrator da?
 * @param {{id: number, aktiv: boolean, admin: boolean}[]} benutzer aktueller Stand
 * @param {{id: number, aktiv?: boolean, admin?: boolean} | {loeschen: number}} aenderung
 */
export function bleibtAdmin(benutzer, aenderung) {
  const nach = benutzer
    .filter((b) => !("loeschen" in aenderung && b.id === aenderung.loeschen))
    .map((b) => ("id" in aenderung && b.id === aenderung.id ? { ...b, ...aenderung } : b));
  return nach.some((b) => b.aktiv && b.admin);
}
