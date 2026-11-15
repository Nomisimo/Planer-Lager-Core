// E2E-Hilfen: Testserver im Prozess + Electron-Apps per Playwright _electron (D-22).
import { createRequire } from "node:module";
import { after } from "node:test";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neueTestDb } from "@lager/db/testdb.js";
import { erstelleLagerServer } from "@lager/server/server.js";
import { legeBenutzerAn } from "@lager/server/grunddaten.js";

export const PW = "Sicheres-Testpasswort-1";

// Sicherheitsnetz gegen hängende Läufe: alles, was ein Test startet, wird am Dateiende geschlossen,
// auch wenn der Test vor seinem try/finally scheitert (Server, Pools, Electron, Browser halten sonst den Prozess offen).
const offen = new Set();
const merke = (x) => { const ende = x.ende; let zu = false; x.ende = async () => { if (zu) return; zu = true; offen.delete(x); await ende.call(x); }; offen.add(x); return x; };
after(async () => { for (const x of [...offen].reverse()) await Promise.race([x.ende().catch(() => {}), new Promise((r) => setTimeout(r, 10000))]); });

const require = createRequire(import.meta.url);
const HIER = path.dirname(fileURLToPath(import.meta.url));
export const ARTEFAKTE = path.join(HIER, "artefakte");
const CORE = path.join(HIER, "..");

function playwright() {
  try { return require("playwright"); } catch {
    return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
  }
}

export const APP_DIRS = {
  materialplaner: path.resolve(CORE, process.env.LAGER_MP_DIR || "../Materialplaner"),
  productionplaner: path.resolve(CORE, process.env.LAGER_PP_DIR || "../Productionplaner"),
};

/** Startet einen Testserver mit frischem Schema. */
export async function starteServer(extra = {}) {
  const db = await neueTestDb({ migrieren: false });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lager-data-"));
  const app = await erstelleLagerServer({ pool: db.pool, config: { dataDir, ...(extra.config || {}) } });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  // Test-Konten haben das Willkommen schon gesehen (sonst läge es über jeder Seite); TOUR-01 prüft es mit eigenem Konto.
  const benutzer = async (benutzername, rolle = "Administrator", name) => {
    const r = await legeBenutzerAn(db.pool, { benutzername, passwort: PW, rolle, name });
    await db.pool.query("UPDATE benutzer SET tour = '{\"willkommen\": true}' WHERE benutzername = $1", [benutzername]);
    return r;
  };
  return merke({ ...app, db, url, benutzer, async ende() { app.server.closeAllConnections?.(); await new Promise((r) => app.server.close(r)); await db.ende(); fs.rmSync(dataDir, { recursive: true, force: true }); }, dataDir });
}

/** Umgebung für die App; serverUrl null = ohne LAGER_SERVER_URL (Adresse wird in der App eingetragen). */
const umgebung = (extra) => { const e = { ...process.env, ...extra }; if (!extra.LAGER_SERVER_URL) delete e.LAGER_SERVER_URL; return e; };
/** Baut (falls nötig) und startet eine App. @param {"materialplaner"|"productionplaner"} name */
const gebaut = new Set();
export async function starteApp(name, serverUrl, { bauen = !process.env.E2E_OHNE_BUILD && !gebaut.has(name), argv = [], env = {} } = {}) {
  const dir = APP_DIRS[name];
  if (bauen) { execSync("node scripts/build.cjs", { cwd: dir, env: { ...process.env, LAGER_CORE_DIR: CORE }, stdio: "pipe" }); gebaut.add(name); }
  const { _electron } = playwright();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), `lager-${name}-`));
  const app = await _electron.launch({
    executablePath: require(path.join(dir, "node_modules", "electron")),
    args: ["--no-sandbox", dir, ...argv],
    env: umgebung({ ELECTRON_DISABLE_SANDBOX: "1", LAGER_SERVER_URL: serverUrl, LAGER_TEST: "1", LAGER_USER_DATA: userData, ...env }),
  });
  const win = await app.firstWindow();
  const ausgabe = [];
  app.process().stdout.on("data", (d) => ausgabe.push(String(d)));
  /** Vom Hauptprozess geöffnete externe Links (Testmodus schreibt sie nach stdout). */
  const externeLinks = () => ausgabe.join("").split("\n").filter((z) => z.startsWith("[shell-extern] ")).map((z) => z.slice(15).trim());
  /** Druckaufträge im Testmodus: {datei, groesse} (FA-10). */
  const druckauftraege = () => ausgabe.join("").split("\n").filter((z) => z.startsWith("[shell-druck] ")).map((z) => { const [datei, groesse] = z.slice(14).trim().split(" "); return { datei, groesse }; });
  return merke({ app, win, userData, externeLinks, druckauftraege, async ende() { await app.close().catch(() => {}); fs.rmSync(userData, { recursive: true, force: true }); } });
}

export const screenshot = (win, name) => { fs.mkdirSync(ARTEFAKTE, { recursive: true }); return win.screenshot({ path: path.join(ARTEFAKTE, name + ".png") }); };

/** Wartet, bis fn() truthy ist (kein festes sleep). */
export async function warteBis(fn, { timeout = 10000, intervall = 50 } = {}) {
  const ende = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > ende) throw new Error("Zeitüberschreitung beim Warten");
    await new Promise((r) => setTimeout(r, intervall));
  }
}

/** Meldet in der App-Oberfläche an. */
export async function anmelden(win, benutzername, passwort = PW) {
  await win.getByLabel("Benutzername").fill(benutzername);
  await win.getByLabel("Passwort").fill(passwort);
  await win.getByRole("button", { name: "Anmelden" }).click();
  await win.getByTestId("benutzer").waitFor({ timeout: 10000 });
}

/** Arbeitsplatz-Browser (Chromium, vorinstalliert) für station-web. Baut station-web vorher, außer E2E_OHNE_BUILD. */
export async function starteBrowser({ viewport = { width: 1280, height: 800 }, args = [], rechte = [] } = {}) {
  if (!process.env.E2E_OHNE_BUILD) { const { baueStationWeb } = await import(path.join(CORE, "packages", "station-web", "build.js")); await baueStationWeb({ minify: false }); }
  // CI: vorhandenes Chrome des Runners (E2E_CHROMIUM), VM: vorinstalliertes Playwright-Chromium
  const browser = await playwright().chromium.launch({ args, ...(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {}) });
  const kontext = await browser.newContext({ viewport, locale: "de-DE", timezoneId: "Europe/Berlin", permissions: rechte });
  return merke({ browser, neueSeite: async () => (await browser.newContext({ viewport, locale: "de-DE", timezoneId: "Europe/Berlin" })).newPage(), seite: await kontext.newPage(), ende: () => browser.close() });
}

const webGebaut = new Set();
/**
 * Ordner mit den Browser-Versionen beider Apps (WEB_APPS_DIR-Aufbau) für starteServer({ config: { webAppsDir } }).
 * Baut `npm run build:web` je App, außer E2E_OHNE_BUILD und dist-web existiert schon.
 */
export function webAppsDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lager-web-"));
  for (const [name, appDir] of Object.entries(APP_DIRS)) {
    const ziel = path.join(appDir, "dist-web");
    if (!webGebaut.has(name) && (!process.env.E2E_OHNE_BUILD || !fs.existsSync(ziel))) {
      execSync("node scripts/build.cjs --web", { cwd: appDir, env: { ...process.env, LAGER_CORE_DIR: CORE }, stdio: "pipe" });
      webGebaut.add(name);
    }
    fs.symlinkSync(ziel, path.join(dir, name));
  }
  return dir;
}

/** Browser-Seite, die Konsolenfehler, Seitenfehler und CSP-Verstöße sammelt (WEB-05, KLICK-02). */
export function sammleFehler(seite) {
  const fehler = [];
  seite.on("console", (m) => { if (m.type() === "error") fehler.push(m.text()); });
  seite.on("pageerror", (e) => fehler.push(String(e?.message || e)));
  return fehler;
}
