// FA-55 Änderungsprotokoll in der Oberfläche: Verlauf am Kunden, Gesamtliste in der Verwaltung.
import { test } from "node:test";
import { starteServer, starteApp, screenshot, anmelden } from "./helfer.js";

test("FA-55 Kunde ändern: Verlauf zeigt wer, alt → neu; Verwaltung listet die Änderung", async () => {
  const s = await starteServer();
  await s.benutzer("chef", "Administrator", "Clara Chef");
  const { rows: [k] } = await s.db.pool.query("INSERT INTO kunde (name, telefon) VALUES ('Anna Müller', '030 111') RETURNING id");
  try {
    const p = await starteApp("productionplaner", s.url);
    try {
      const w = p.win;
      await anmelden(w, "chef");
      await w.evaluate((id) => { location.hash = `#/kunden/${id}/bearbeiten`; }, k.id);
      await w.getByLabel("Telefon").fill("030 222");
      await w.getByRole("button", { name: "Speichern" }).click();
      const verlauf = w.locator(".lp-section").filter({ hasText: "Änderungsverlauf" });
      await verlauf.getByRole("button", { name: "Anzeigen" }).click();
      await verlauf.getByText("Telefon: 030 111 → 030 222").waitFor();
      await verlauf.getByRole("cell", { name: "Clara Chef" }).waitFor();
      await screenshot(w, "FA-55-verlauf-kunde");
      await w.evaluate(() => { location.hash = "#/verwaltung/aenderungen"; });
      await w.getByRole("heading", { name: "Änderungsprotokoll" }).waitFor();
      await w.getByLabel("Bereich").selectOption("kunde");
      await w.getByText("Telefon: 030 111 → 030 222").waitFor();
      await screenshot(w, "FA-55-aenderungsprotokoll");
    } finally { await p.ende(); }
  } finally { await s.ende(); }
});
