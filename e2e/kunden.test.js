import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { starteServer, starteApp, screenshot, anmelden } from "./helfer.js";
import { kontaktformularPdf } from "@lager/server/kunden.js";

test("FA-26 FA-27 Productionplaner: Kunde mit Adresssuche anlegen, Dublettenwarnung, Formular-Import mit Vorschau", async () => {
  const s = await starteServer({ config: { adressSuche: async () => [{ strasse: "Domkloster 4", plz: "50667", ort: "Köln", text: "Domkloster 4, 50667 Köln" }] } });
  await s.benutzer("buero", "Büro / Disposition", "Bea Büro");
  const pdf = await PDFDocument.load(await kontaktformularPdf("Test"));
  pdf.getForm().getTextField("kunde.name").setText("Clara Neu");
  pdf.getForm().getTextField("kunde.firma").setText("Bühnenbau Müller");
  const datei = path.join(os.tmpdir(), "kontakt-e2e.pdf");
  fs.writeFileSync(datei, await pdf.save());
  try {
    const p = await starteApp("productionplaner", s.url);
    try {
      const w = p.win;
      await anmelden(w, "buero");
      await w.getByRole("navigation", { name: "Hauptmenü" }).getByText("Kunden", { exact: true }).click();
      await w.getByRole("button", { name: "Neuer Kunde" }).click();
      await w.getByLabel("Firma").fill("Bühnenbau Müller GmbH");
      await w.getByLabel("Ansprechpartner").fill("Anna Müller");
      await w.getByLabel("Adresse suchen").fill("Domkloster");
      await w.getByRole("button", { name: "Domkloster 4, 50667 Köln" }).click();
      assert.equal(await w.getByLabel("PLZ").inputValue(), "50667");
      await w.getByRole("button", { name: "Speichern" }).click();
      await w.getByRole("heading", { name: "Bühnenbau Müller GmbH" }).waitFor();
      // Dublette beim manuellen Anlegen
      await w.getByRole("navigation", { name: "Hauptmenü" }).getByText("Kunden", { exact: true }).click();
      await w.getByRole("button", { name: "Neuer Kunde" }).click();
      await w.getByLabel("Ansprechpartner").fill("Anna Mueller");
      await w.getByLabel("Ort").fill("Köln");
      await w.getByRole("button", { name: "Speichern" }).click();
      await w.getByRole("heading", { name: "Mögliche Dubletten" }).waitFor();
      await screenshot(w, "FA-26-dublette");
      // Import
      await w.getByRole("navigation", { name: "Hauptmenü" }).getByText("Kunden", { exact: true }).click();
      await w.getByTestId("import-datei").setInputFiles(datei);
      await w.getByRole("dialog", { name: "Vorschau: Kontaktformular" }).getByText("Clara Neu").waitFor();
      await w.getByText("Mögliche Dubletten gefunden").waitFor();
      await screenshot(w, "FA-27-import-vorschau");
      await w.getByRole("button", { name: "Als neuen Kunden anlegen" }).click();
      await w.getByRole("heading", { name: "Bühnenbau Müller" }).waitFor();
    } finally { await p.ende(); }
  } finally { await s.ende(); fs.rmSync(datei, { force: true }); }
});
