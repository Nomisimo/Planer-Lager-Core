// NUTZER (ZUSATZ.md Phase 17): gemeinsame Hilfen für die Arbeitstag-Szenarien. Server mit Demo-Daten (--seed demo),
// M und P gleichzeitig offen (eine davon im Browser), Bedienung nur über die Oberfläche.
import fs from "node:fs";
import { starteServer, webAppsDir, screenshot } from "./helfer.js";
import { ladeBeispiel, BEISPIEL_PASSWORT } from "../packages/server/src/beispiel.js";

export { BEISPIEL_PASSWORT };
export const JAHR = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric" }).format(new Date());
export const NAECHSTES = Number(JAHR) + 1;

/** Server mit Browser-Versionen beider Apps und Demo-Daten. */
export async function arbeitstag(config = {}) {
  const web = webAppsDir();
  const s = await starteServer({ config: { webAppsDir: web, ...config } });
  await ladeBeispiel({ pool: s.db.pool, config: { dataDir: s.dataDir } });
  const ende = s.ende;
  s.ende = async () => { await ende(); fs.rmSync(web, { recursive: true, force: true }); };
  s.q = (sql, w) => s.db.pool.query(sql, w);
  return s;
}

/** Meldet ein Fenster/eine Seite mit einem Demo-Konto an. */
export async function melde(win, benutzer) {
  await win.getByLabel("Benutzername").fill(benutzer);
  await win.getByLabel("Passwort").fill(BEISPIEL_PASSWORT);
  await win.getByRole("button", { name: "Anmelden" }).click();
  await win.getByTestId("benutzer").waitFor({ timeout: 15000 });
}

/** Öffnet eine App im Browser und meldet an. */
export async function imBrowser(b, s, app, benutzer) {
  const seite = await b.neueSeite();
  await seite.goto(`${s.url}/${app}/`);
  await melde(seite, benutzer);
  return seite;
}

export const menue = (win, titel) => win.getByRole("navigation", { name: "Hauptmenü" }).getByText(titel, { exact: true }).click();

/** Screenshot mit Szenario-Präfix (3–5 je Szenario). */
export const bild = (win, id, name) => screenshot(win, `${id}-${name}`);
