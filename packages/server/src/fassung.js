// GLEICH: Fassung beim Speichern prüfen (Logik in @lager/db/version.js), Antworten für die Oberfläche (409, gelöscht).
import { pruefeFassung } from "@lager/db/version.js";
import { HttpFehler } from "./router.js";

const GEHEIM = ["passwort_hash", "totp_geheimnis", "pin_hash", "token_hash", "einrichtung_hash"];
const uhrzeit = (d) => (d ? new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(d)) + " Uhr" : "gerade eben");

/** Speicher-Routen → Tabelle (für Tests und Doku; die Prüfung selbst steht in der Route). */
export const FASSUNG_ROUTEN = {
  "/api/v1/angebote/:id": "angebot",
  "/api/v1/artikel/:id": "artikel",
  "/api/v1/aufgaben-regeln/:id": "aufgabe_regel",
  "/api/v1/aufgaben/:id": "aufgabe",
  "/api/v1/dateien/:id": "projekt_datei",
  "/api/v1/einsaetze/:id": "einsatz",
  "/api/v1/etiketten/bestellungen/:id": "etikett_bestellung",
  "/api/v1/etiketten/vorlagen/:id": "etikett_vorlage",
  "/api/v1/fahrten/:id": "fahrt",
  "/api/v1/fahrzeuge/:id": "fahrzeug",
  "/api/v1/geraete/:id": "geraet",
  "/api/v1/kategorien/:id": "kategorie",
  "/api/v1/kontakte/:id": "kunde_kontakt",
  "/api/v1/kunden/:id": "kunde",
  "/api/v1/lagerorte/:id": "lagerort",
  "/api/v1/personal/:id": "personal",
  "/api/v1/projekte/:id": "projekt",
  "/api/v1/projektvorlagen/:id": "projekt_vorlage",
  "/api/v1/reparaturen/:id": "reparatur",
  "/api/v1/verwaltung/arbeitsplaetze/:id": "arbeitsplatz",
  "/api/v1/verwaltung/benutzer/:id": "benutzer",
  "/api/v1/verwaltung/einstellungen": "einstellungen",
  "/api/v1/verwaltung/mitarbeiter/:id": "mitarbeiter",
  "/api/v1/verwaltung/rollen/:id": "rolle",
  "/api/v1/verwaltung/scanner/:id": "scanner",
  "/api/v1/verwaltung/zonen/:id": "ladezone"
};

export const TEXT_FASSUNG_FEHLT = "Beim Speichern fehlt die Fassung des Datensatzes. Lade die Seite neu und versuche es erneut.";

/** 409-Text laut ZUSATZ.md GLEICH. */
export const konfliktText = (von, am) => `Das hat gerade ${von || "jemand anderes"} geändert (${uhrzeit(am)}). Deine Eingaben sind noch da. Lade die neue Fassung und übernimm deine Änderungen.`;
export const geloeschtText = (was, von) => `${was} wurde ${von ? `von ${von} ` : ""}gelöscht. Zurück zur Liste.`;

/**
 * Wirft 409 (andere Fassung), 404 (inzwischen gelöscht) oder 428 (Fassung fehlt); sonst die gesperrte Zeile.
 * @param {any} ctx @param {{query: Function}} c @param {string} tabelle @param {number} id
 * @param {{was?: string, version?: any}} [opt] was: „Der Kunde“ … für den Lösch-Text
 */
export async function sichereFassung(ctx, c, tabelle, id, { was = "Der Datensatz", version = ctx.body?.version } = {}) {
  if (!Number.isInteger(id) || id < 1) throw new HttpFehler(404, `${was} wurde nicht gefunden. Prüfe die Adresse.`);
  const r = await pruefeFassung(c, tabelle, id, version);
  if (r.status === "ok") return r.zeile;
  if (r.status === "fehlt") throw new HttpFehler(428, TEXT_FASSUNG_FEHLT, { ok: false, level: "error", text: TEXT_FASSUNG_FEHLT });
  if (r.status === "geloescht") {
    const text = geloeschtText(was, r.von);
    throw new HttpFehler(404, text, { ok: false, level: "error", text, geloescht: true, von: r.von });
  }
  const aktuell = { ...r.aktuell };
  for (const k of GEHEIM) delete aktuell[k];
  const text = konfliktText(r.von, r.am);
  throw new HttpFehler(409, text, { ok: false, level: "warning", text, konflikt: true, aktuell, von: r.von, am: r.am });
}
