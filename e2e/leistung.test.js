// NFA-05 Seitenaufruf unter 1 Sekunde bei 5.000 Geräten und 500 Projekten (in der App gemessen: Klick im Menü bis Tabelle sichtbar).
import { test } from "node:test";
import assert from "node:assert/strict";
import { starteServer, starteApp, screenshot, anmelden } from "./helfer.js";
import { seed, GROSS } from "../packages/server/src/seed.js";

const GRENZE_MS = 1000;

async function miss(win, menueEintrag) {
  const menue = win.getByRole("navigation", { name: "Hauptmenü" });
  const t = Date.now();
  await menue.getByText(menueEintrag, { exact: true }).click();
  await win.locator("table.lp-tabelle tbody tr").nth(9).waitFor({ timeout: 10000 });
  return Date.now() - t;
}

test("NFA-05 Seitenaufruf in beiden Apps unter 1 s bei 5.000 Geräten / 500 Projekten", async () => {
  const s = await starteServer();
  await s.benutzer("chef", "Administrator", "Chris Chef");
  await seed(s.db.pool, GROSS);
  await s.db.pool.query("ANALYZE");
  const werte = {};
  try {
    const m = await starteApp("materialplaner", s.url);
    try {
      await anmelden(m.win, "chef");
      for (const e of ["Geräte", "Material", "Geräte"]) werte[`M ${e}`] = await miss(m.win, e);
      await screenshot(m.win, "NFA-05-geraete-gross");
    } finally { await m.ende(); }
    const p = await starteApp("productionplaner", s.url);
    try {
      await anmelden(p.win, "chef");
      for (const e of ["Projekte", "Angebote", "Kunden", "Projekte"]) werte[`P ${e}`] = await miss(p.win, e);
      await screenshot(p.win, "NFA-05-projekte-gross");
    } finally { await p.ende(); }
  } finally { await s.ende(); }
  console.log("NFA-05 Seitenaufruf (ms):", werte);
  for (const [k, ms] of Object.entries(werte)) assert.ok(ms < GRENZE_MS, `${k}: ${ms} ms`);
});
