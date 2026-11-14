import { test } from "node:test";
import { starteServer, starteApp, screenshot, anmelden } from "./helfer.js";
import { seed } from "../packages/server/src/seed.js";

// UI-6 / Phase 15: Hauptseiten beider Apps mit Testdaten in Hell, Dunkel und einem weiteren Thema (für die Sichtprüfung).
const DESIGNS = [
  { name: "hell", design: { thema: "planer", modus: "hell", dichte: "normal" } },
  { name: "dunkel", design: { thema: "planer", modus: "dunkel", dichte: "normal" } },
  { name: "gruen-kompakt", design: { thema: "gruen", modus: "dunkel", dichte: "kompakt" } },
];
const SEITEN = {
  materialplaner: ["Übersicht", "Material", "Geräte", "Etiketten", "Lagerorte", "Ladezonen", "Code scannen", "Reparatur"],
  productionplaner: ["Übersicht", "Kunden", "Projekte", "Kalender", "Aufgaben", "Angebote", "Personal", "Kalkulator"],
};

test("UI-6 UI-1 Hauptseiten beider Apps in Hell, Dunkel und Grün/kompakt", async () => {
  const s = await starteServer();
  try {
    await seed(s.db.pool, { geraete: 60, projekte: 8, artikel: 15, kunden: 6, positionen: 4 });
    await s.benutzer("leitung", "Lagerleitung", "Lea Leitung");
    await s.benutzer("buero", "Büro / Disposition", "Bea Büro");
    for (const [app, benutzer] of [["materialplaner", "leitung"], ["productionplaner", "buero"]]) {
      const a = await starteApp(app, s.url);
      try {
        const w = a.win;
        await anmelden(w, benutzer);
        const menue = w.getByRole("navigation", { name: "Hauptmenü" });
        for (const d of DESIGNS) {
          await w.evaluate((x) => localStorage.setItem("lager_design", JSON.stringify(x)), d.design);
          await w.reload();
          await w.getByTestId("benutzer").waitFor();
          for (const titel of SEITEN[app]) {
            const eintrag = menue.getByText(titel, { exact: true });
            if (!(await eintrag.count())) continue;
            await eintrag.click();
            await w.locator("main h1, main h2").first().waitFor();
            await w.waitForTimeout(300); // Daten nachladen lassen
            await screenshot(w, `PH15-${app}-${d.name}-${titel.replace(/[^A-Za-zÄÖÜäöü]/g, "")}`);
          }
        }
      } finally { await a.ende(); }
    }
  } finally { await s.ende(); }
});
