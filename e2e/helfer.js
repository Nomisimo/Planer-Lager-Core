// E2E-Hilfen: Testserver im Prozess + Electron-Apps per Playwright _electron (D-22).
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neueTestDb } from "@lager/db/testdb.js";
import { erstelleLagerServer } from "@lager/server/server.js";
import { legeBenutzerAn } from "@lager/server/grunddaten.js";

export const PW = "Sicheres-Testpasswort-1";

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
  const benutzer = (benutzername, rolle = "Administrator", name) => legeBenutzerAn(db.pool, { benutzername, passwort: PW, rolle, name });
  return { ...app, db, url, benutzer, async ende() { app.server.closeAllConnections?.(); await new Promise((r) => app.server.close(r)); await db.ende(); fs.rmSync(dataDir, { recursive: true, force: true }); }, dataDir };
}

/** Baut (falls nötig) und startet eine App. @param {"materialplaner"|"productionplaner"} name */
const gebaut = new Set();
export async function starteApp(name, serverUrl, { bauen = !process.env.E2E_OHNE_BUILD && !gebaut.has(name), argv = [] } = {}) {
  const dir = APP_DIRS[name];
  if (bauen) { execSync("node scripts/build.cjs", { cwd: dir, env: { ...process.env, LAGER_CORE_DIR: CORE }, stdio: "pipe" }); gebaut.add(name); }
  const { _electron } = playwright();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), `lager-${name}-`));
  const app = await _electron.launch({
    executablePath: require(path.join(dir, "node_modules", "electron")),
    args: ["--no-sandbox", dir, ...argv],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: "1", LAGER_SERVER_URL: serverUrl, LAGER_TEST: "1", LAGER_USER_DATA: userData },
  });
  const win = await app.firstWindow();
  const ausgabe = [];
  app.process().stdout.on("data", (d) => ausgabe.push(String(d)));
  /** Vom Hauptprozess geöffnete externe Links (Testmodus schreibt sie nach stdout). */
  const externeLinks = () => ausgabe.join("").split("\n").filter((z) => z.startsWith("[shell-extern] ")).map((z) => z.slice(15).trim());
  /** Druckaufträge im Testmodus: {datei, groesse} (FA-10). */
  const druckauftraege = () => ausgabe.join("").split("\n").filter((z) => z.startsWith("[shell-druck] ")).map((z) => { const [datei, groesse] = z.slice(14).trim().split(" "); return { datei, groesse }; });
  return { app, win, externeLinks, druckauftraege, async ende() { await app.close().catch(() => {}); fs.rmSync(userData, { recursive: true, force: true }); } };
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
export async function starteBrowser({ viewport = { width: 1280, height: 800 } } = {}) {
  if (!process.env.E2E_OHNE_BUILD) { const { baueStationWeb } = await import(path.join(CORE, "packages", "station-web", "build.js")); await baueStationWeb({ minify: false }); }
  const browser = await playwright().chromium.launch();
  const kontext = await browser.newContext({ viewport, locale: "de-DE", timezoneId: "Europe/Berlin" });
  return { browser, neueSeite: async () => (await browser.newContext({ viewport, locale: "de-DE", timezoneId: "Europe/Berlin" })).newPage(), seite: await kontext.newPage(), ende: () => browser.close() };
}
