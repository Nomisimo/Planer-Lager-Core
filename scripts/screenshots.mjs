// Screenshots für die READMEs (Phase 19): Testserver mit Demo-Daten, beide Apps als Electron-App, Browser-Übersicht
// und Arbeitsplatz-Web. Ablage: docs/screenshots/ im Core und in beiden App-Repos (je App nur die eigenen Bilder).
// Aufruf: `npm run screenshots` (xvfb-run, PostgreSQL wie bei `npm run e2e`).
import fs from "node:fs";
import path from "node:path";
import { starteApp, starteBrowser, APP_DIRS } from "../e2e/helfer.js";
import { arbeitstag, melde, menue } from "../e2e/nutzer-helfer.js";

const CORE = path.join(import.meta.dirname, "..");
const ziele = { core: path.join(CORE, "docs", "screenshots"), m: path.join(APP_DIRS.materialplaner, "docs", "screenshots"), p: path.join(APP_DIRS.productionplaner, "docs", "screenshots") };
for (const d of Object.values(ziele)) fs.mkdirSync(d, { recursive: true });
const bild = async (seite, wo, name) => {
  await seite.waitForTimeout(400);
  const datei = path.join(ziele[wo], `${name}.png`);
  await seite.screenshot({ path: datei });
  if (wo !== "core") fs.copyFileSync(datei, path.join(ziele.core, `${name}.png`));
  console.log("  ", path.relative(path.join(CORE, ".."), datei));
};

const s = await arbeitstag();
const { rows: [fest] } = await s.q("SELECT id FROM projekt WHERE name = 'Stadtfest Neustadt'");
const { rows: [angebot] } = await s.q("SELECT id FROM angebot WHERE projekt_id = $1 ORDER BY id LIMIT 1", [fest.id]);
try {
  const m = await starteApp("materialplaner", s.url);
  try {
    const w = m.win;
    await melde(w, "lena");
    await bild(w, "m", "materialplaner-uebersicht");
    await menue(w, "Geräte"); await w.locator(".lp-tabelle tbody tr").first().waitFor(); await bild(w, "m", "materialplaner-geraete");
    await w.evaluate((id) => { location.hash = `#/projekte/${id}/packen`; }, fest.id); await w.getByText("Stadtfest Neustadt").first().waitFor(); await bild(w, "m", "materialplaner-packen");
    await menue(w, "Ladezonen"); await w.getByText("Rampe 1").first().waitFor(); await bild(w, "m", "materialplaner-ladezonen");
    await menue(w, "Etiketten"); await bild(w, "m", "materialplaner-etiketten");
  } finally { await m.ende(); }
  const p = await starteApp("productionplaner", s.url);
  try {
    const w = p.win;
    await melde(w, "paula");
    await bild(w, "p", "productionplaner-uebersicht");
    await menue(w, "Kalender"); await w.locator(".lp-kalender-balken").first().waitFor(); await bild(w, "p", "productionplaner-kalender");
    await w.evaluate((id) => { location.hash = `#/projekte/${id}`; }, fest.id); await w.getByRole("heading", { name: /Stadtfest Neustadt/ }).waitFor(); await bild(w, "p", "productionplaner-projekt");
    if (angebot) { await w.evaluate((id) => { location.hash = `#/angebote/${id}`; }, angebot.id); await w.getByText("Stadtfest Neustadt").first().waitFor(); await bild(w, "p", "productionplaner-angebot"); }
    await w.evaluate(() => { location.hash = "#/hilfe"; }); await w.getByRole("button", { name: /^Tour „Productionplaner/ }).click();
    await w.getByTestId("tour-blase").waitFor(); await w.getByTestId("tour-blase").getByRole("button", { name: "Weiter" }).click();
    await w.waitForTimeout(500); await bild(w, "p", "productionplaner-tour");
  } finally { await p.ende(); }
  const b = await starteBrowser();
  try {
    const seite = b.seite;
    await seite.goto(`${s.url}/`); await bild(seite, "core", "server-startseite");
    await seite.goto(`${s.url}/materialplaner/`); await melde(seite, "tom"); await menue(seite, "Code scannen"); await bild(seite, "core", "browser-materialplaner-scannen");
  } finally { await b.ende(); }
  console.log("Screenshots fertig.");
} finally { await s.ende(); }
