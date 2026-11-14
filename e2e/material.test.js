import { test } from "node:test";
import assert from "node:assert/strict";
import { starteServer, starteApp, screenshot, anmelden } from "./helfer.js";

test("FA-01 FA-02 FA-03 FA-04 FA-16 Materialplaner: Kategorie + Artikel anlegen, Warnzeichen Mindestbestand, Gerät vermisst/gefunden mit Verlauf", async () => {
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
    } finally { await m.ende(); }
  } finally { await s.ende(); }
});
