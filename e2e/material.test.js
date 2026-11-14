import { test } from "node:test";
import assert from "node:assert/strict";
import { starteServer, starteApp, screenshot, anmelden } from "./helfer.js";

test("FA-01 FA-02 FA-03 FA-04 FA-05 FA-16 Materialplaner: Kategorie + Artikel anlegen, Warnzeichen Mindestbestand, Gerät vermisst/gefunden mit Verlauf", async () => {
  const s = await starteServer();
  await s.benutzer("leitung", "Lagerleitung", "Lars Leitung");
  try {
    const m = await starteApp("materialplaner", s.url);
    try {
      const w = m.win;
      await anmelden(w, "leitung");
      await w.getByRole("navigation", { name: "Hauptmenü" }).getByText("Material", { exact: true }).click();
      await w.getByRole("tab", { name: "Kategorien" }).click();
      await w.getByRole("button", { name: "Neue Kategorie" }).click();
      await w.getByLabel("Name").fill("Lautsprecher");
      await w.getByLabel("Name").blur();
      await w.waitForFunction(() => document.querySelector('input[maxlength="4"]')?.value === "LA");
      await w.getByRole("button", { name: "Speichern" }).click();
      await w.getByRole("cell", { name: "LA", exact: true }).waitFor();
      // Verbrauchsartikel mit niedrigem Bestand
      await w.getByRole("button", { name: "Material aufnehmen" }).click();
      await w.getByRole("radio", { name: "Verbrauch" }).click();
      await w.getByLabel("Name").fill("Gaffa");
      await w.getByLabel("Kategorie").selectOption({ label: "Lautsprecher (LA)" });
      await w.getByLabel("Bestand", { exact: true }).fill("2");
      await w.getByLabel("Mindestbestand").fill("5");
      await w.getByRole("button", { name: "Speichern" }).click();
      await w.getByText("Mindestbestand erreicht").waitFor();
      await w.getByRole("button", { name: "Bestand setzen" }).waitFor();
      // Gerät-Artikel ohne Kennzeichnung, dann 1 Gerät anlegen
      await w.getByRole("navigation", { name: "Hauptmenü" }).getByText("Material", { exact: true }).click();
      await w.locator("[data-niedrig]").waitFor();
      await w.getByRole("button", { name: "Material aufnehmen" }).click();
      await w.getByLabel("Name").fill("K12 Topteil");
      await w.getByLabel("Kategorie").selectOption({ label: "Lautsprecher (LA)" });
      await w.getByLabel("Mietpreis pro Stück und Tag").fill("45,50");
      await w.getByLabel("Anzahl Geräte").fill("0");
      await w.getByRole("button", { name: "Speichern" }).click();
      await w.getByText("45,50 €").waitFor();
      await w.getByRole("button", { name: "Gerät anlegen" }).click();
      await w.getByRole("cell", { name: "LA-0001" }).click();
      await w.getByRole("button", { name: "Vermisst" }).click();
      await w.getByRole("button", { name: "Gefunden" }).click();
      await w.getByRole("cell", { name: "Wieder gefunden, zurück im Lager" }).waitFor();
      await w.getByRole("cell", { name: "Als vermisst gemeldet" }).waitFor();
      assert.equal(await w.getByRole("cell", { name: "Lars Leitung" }).count() + await w.getByRole("cell", { name: "leitung" }).count() >= 1, true);
      await screenshot(w, "FA-03-geraetedetail");
      // Codefeld (R-22): „la1“ öffnet das Gerät
      await w.getByTestId("codefeld").fill("la1");
      await w.getByTestId("codefeld").press("Enter");
      await w.getByRole("heading", { name: "LA-0001" }).waitFor();
      // FA-05 Reservierungen (vorgemerkt/fest) im Zeitraum auf der Material-Detailseite
      const q = (sql, v) => s.db.pool.query(sql, v);
      const { rows: [art] } = await q("SELECT id FROM artikel WHERE name = 'K12 Topteil'");
      const { rows: [kd] } = await q("INSERT INTO kunde (name) VALUES ('Stadt') RETURNING id");
      for (const [nr, beginn, status, menge] of [["P-2027-001", "2027-08-10", "angenommen", 2], ["P-2027-002", "2027-10-01", "versendet", 3]]) {
        const { rows: [p] } = await q("INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn, ende) VALUES ($1, 'projekt', $2, $4, 'bestaetigt', $3, $3::date + 2) RETURNING id", [nr, `Fest ${nr}`, beginn, kd.id]);
        const { rows: [a] } = await q("INSERT INTO angebot (nummer, projekt_id, status) VALUES ($1, $2, $3) RETURNING id", [nr.replace("P", "A"), p.id, status]);
        await q("INSERT INTO angebot_position (angebot_id, pos, art, artikel_id, menge) VALUES ($1, 1, 'miete', $2, $3)", [a.id, art.id, menge]);
      }
      await w.getByRole("navigation", { name: "Hauptmenü" }).getByText("Material", { exact: true }).click();
      await w.getByRole("cell", { name: "K12 Topteil" }).click();
      const res = w.getByRole("heading", { name: "Reservierungen" }).locator("xpath=../..");
      await res.getByRole("cell", { name: "P-2027-001 Fest P-2027-001" }).waitFor();
      await res.getByRole("cell", { name: "P-2027-002 Fest P-2027-002" }).waitFor();
      assert.deepEqual(await res.getByRole("cell", { name: /^(fest|vorgemerkt)$/ }).allTextContents(), ["fest", "vorgemerkt"]);
      await res.getByLabel("Von").fill("2027-09-01");
      await res.getByRole("cell", { name: "P-2027-001 Fest P-2027-001" }).waitFor({ state: "detached" });
      await res.getByLabel("Bis").fill("2027-09-30");
      await res.getByText("Keine Reservierungen.").waitFor();
      await screenshot(w, "FA-05-reservierungen");
    } finally { await m.ende(); }
  } finally { await s.ende(); }
});
