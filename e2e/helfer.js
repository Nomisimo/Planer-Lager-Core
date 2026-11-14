// E2E-Hilfen: Testserver im Prozess + Electron-Apps per Playwright _electron (D-22).
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neueTestDb } from "@lager/db/testdb.js";
import { erstelleApp } from "@lager/server/app.js";

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
  const db = await neueTestDb();
  const app = erstelleApp({ pool: db.pool, ...extra });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  return { ...app, db, url, async ende() { app.server.closeAllConnections?.(); await new Promise((r) => app.server.close(r)); await db.ende(); } };
}

/** Baut (falls nötig) und startet eine App. @param {"materialplaner"|"productionplaner"} name */
export async function starteApp(name, serverUrl, { bauen = !process.env.E2E_OHNE_BUILD } = {}) {
  const dir = APP_DIRS[name];
  if (bauen) execSync("node scripts/build.cjs", { cwd: dir, env: { ...process.env, LAGER_CORE_DIR: CORE }, stdio: "pipe" });
  const { _electron } = playwright();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), `lager-${name}-`));
  const app = await _electron.launch({
    executablePath: require(path.join(dir, "node_modules", "electron")),
    args: ["--no-sandbox", dir],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: "1", LAGER_SERVER_URL: serverUrl, LAGER_TEST: "1", LAGER_USER_DATA: userData },
  });
  const win = await app.firstWindow();
  return { app, win, async ende() { await app.close().catch(() => {}); fs.rmSync(userData, { recursive: true, force: true }); } };
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
