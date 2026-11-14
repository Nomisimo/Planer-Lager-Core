// FA-28 Ansprechpartner und Kundenhistorie in der Kundenseite des Productionplaners.
import { test } from "node:test";
import assert from "node:assert/strict";
import { starteServer, starteApp, screenshot, anmelden } from "./helfer.js";

test("FA-28 UI-4 Ansprechpartner hinzufügen und Telefonat in der Historie eintragen", async () => {
  const s = await starteServer();
  await s.benutzer("buero", "Büro / Disposition", "Bea Büro");
  const { rows: [k] } = await s.db.pool.query("INSERT INTO kunde (name, firma) VALUES ('Stadtwerke', 'Stadtwerke Köln') RETURNING id");
  try {
    const p = await starteApp("productionplaner", s.url);
    try {
      const w = p.win;
      await anmelden(w, "buero");
      await w.evaluate((id) => { location.hash = `#/kunden/${id}`; }, k.id);
      await w.getByRole("button", { name: "Ansprechpartner", exact: true }).click();
      const dlg = w.getByRole("dialog");
      await dlg.getByLabel("Name").fill("Petra Technik");
      await dlg.getByLabel("Funktion").fill("Technische Leitung");
      await dlg.getByLabel("Telefon").fill("0221 123");
      await dlg.getByRole("button", { name: "Speichern" }).click();
      await w.getByText("Ansprechpartner Petra Technik angelegt.").waitFor();
      const hist = w.locator(".lp-section").filter({ hasText: "Historie" }).last();
      await hist.getByLabel("Art").selectOption("telefon");
      await hist.getByLabel("Mit").selectOption({ label: "Petra Technik" });
      await hist.getByLabel("Eintrag").fill("Bühnenmaße geklärt");
      await hist.getByRole("button", { name: "Eintragen" }).click();
      await hist.getByRole("cell", { name: "Telefonat mit Petra Technik" }).waitFor();
      await hist.getByText("Bea Büro").waitFor();
      await screenshot(w, "FA-28-kunde-kontakte");
      // UI-4 Löschen nur nach Sicherheitsabfrage: Abbrechen lässt alles stehen, Bestätigen löscht
      await w.getByRole("button", { name: "Petra Technik entfernen" }).click();
      const frage = w.getByRole("dialog", { name: "Petra Technik entfernen?" });
      await frage.getByRole("button", { name: "Abbrechen" }).click();
      await frage.waitFor({ state: "detached" });
      assert.equal(await w.getByRole("button", { name: "Petra Technik entfernen" }).count(), 1, "nach Abbrechen noch da");
      await w.getByRole("button", { name: "Petra Technik entfernen" }).click();
      await frage.getByRole("button", { name: "Entfernen" }).click();
      await w.getByText("Noch keine Ansprechpartner.").waitFor();
    } finally { await p.ende(); }
  } finally { await s.ende(); }
});
