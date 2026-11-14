import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { starteServer, starteApp, screenshot, anmelden } from "./helfer.js";

test("FA-29 FA-30 FA-31 FA-32 FA-33 FA-34 T-19 T-24 Productionplaner: Projekt, Jobs, Aufgaben, Dateien, Kalender", async () => {
  const s = await starteServer();
  await s.benutzer("buero", "Büro / Disposition", "Berta Büro");
  await s.db.pool.query("INSERT INTO kunde (name, firma) VALUES ('Anna Müller', 'Stadtwerke Köln'), ('Bernd Beispiel', '')");
  const jahr = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric" }).format(new Date());
  const monat = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date()).slice(0, 7);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lager-upload-"));
  // Umlaut-Dateiname wird als Puffer übergeben (Playwright-Pfadübergabe verliert Umlaute unter xvfb).
  fs.writeFileSync(path.join(tmp, "logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  fs.writeFileSync(path.join(tmp, "tool.exe"), "MZ");
  try {
    const p = await starteApp("productionplaner", s.url);
    try {
      const w = p.win;
      await anmelden(w, "buero");
      const menue = w.getByRole("navigation", { name: "Hauptmenü" });
      // Projekt anlegen (vom Kunden aus)
      await menue.getByText("Kunden", { exact: true }).click();
      await w.getByRole("cell", { name: "Stadtwerke Köln" }).first().click();
      await w.getByRole("button", { name: "Neues Projekt" }).click();
      await w.getByLabel("Name").fill("Stadtfest");
      assert.equal(await w.getByLabel("Kunde").inputValue(), "1", "Kunde vorbelegt");
      await w.getByLabel("Beginn").fill(`${monat}-10`);
      await w.getByLabel("Ende").fill(`${monat}-12`);
      await w.getByLabel("Ort").fill("Heumarkt");
      await w.getByRole("button", { name: "Speichern" }).click();
      await w.getByRole("heading", { name: `P-${jahr}-001 Stadtfest` }).waitFor();
      // T-19: Job zu Projekt anlegen → Kunde übernommen
      await w.getByRole("tab", { name: /Jobs/ }).click();
      await w.getByRole("button", { name: "Job anlegen" }).click();
      await w.getByLabel("Name").fill("Stadtfest Ton");
      await w.getByLabel("Gewerk").selectOption("Ton");
      assert.equal(await w.getByLabel("Kunde").count(), 0, "Kunde kommt vom Projekt");
      await w.getByRole("button", { name: "Speichern" }).click();
      await w.getByRole("heading", { name: `J-${jahr}-001 Stadtfest Ton` }).waitFor();
      await w.getByText(/Stadtwerke Köln/).first().waitFor();
      await w.getByText(`P-${jahr}-001 Stadtfest`, { exact: true }).waitFor();
      // Job unter Job: Formular bietet nur Projekte an, API lehnt ab
      await w.getByRole("button", { name: "Bearbeiten" }).click();
      const optionen = await w.getByLabel("Gehört zu Projekt").locator("option").allTextContents();
      assert.ok(!optionen.some((o) => o.startsWith("J-")), "Jobs sind keine Oberprojekte");
      await w.goBack();
      await w.getByText(`P-${jahr}-001 Stadtfest`, { exact: true }).click();
      await w.getByRole("heading", { name: `P-${jahr}-001 Stadtfest` }).waitFor();
      // Jobs nach Gewerk
      await w.getByRole("tab", { name: /Jobs/ }).click();
      await w.getByRole("button", { name: "Jobs nach Gewerk" }).click();
      await w.getByLabel("Licht").check();
      await w.getByLabel("Strom").check();
      await w.getByRole("button", { name: "2 Job(s) anlegen" }).click();
      await w.getByRole("cell", { name: "Stadtfest – Licht" }).waitFor();
      await w.getByRole("cell", { name: "Stadtfest – Strom" }).waitFor();
      // FA-32 Aufgaben
      await w.getByRole("tab", { name: /Aufgaben/ }).click();
      await w.getByLabel("Neue Aufgabe").fill("Genehmigung Ordnungsamt");
      await w.getByLabel("Fällig am").fill("2020-01-15");
      await w.getByLabel("Zuständig").selectOption({ label: "Berta Büro" });
      await w.getByRole("button", { name: "Hinzufügen" }).click();
      await w.getByRole("cell", { name: "Genehmigung Ordnungsamt", exact: true }).waitFor();
      await w.getByLabel("überfällig").first().waitFor();
      await w.getByText("1 überfällig").waitFor();
      // FA-33 Dateien, T-24 SVG nur Download
      await w.getByRole("tab", { name: /Dateien/ }).click();
      await w.getByLabel("Kategorie").selectOption("plan");
      await w.getByTestId("datei-upload").setInputFiles({ name: "Bühnenplan.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 e2e") });
      await w.getByText(/Datei\(en\) hochgeladen: Bühnenplan.pdf/).waitFor();
      await w.getByTestId("datei-upload").setInputFiles(path.join(tmp, "logo.svg"));
      await w.getByRole("cell", { name: "Bühnenplan.pdf", exact: true }).waitFor();
      await w.getByRole("cell", { name: "logo.svg", exact: true }).waitFor();
      assert.equal(await w.getByRole("row", { name: /logo\.svg/ }).getByRole("button", { name: "Ansehen" }).count(), 0, "T-24: SVG nie inline");
      assert.equal(await w.getByRole("row", { name: /Bühnenplan\.pdf/ }).getByRole("button", { name: "Ansehen" }).count(), 1);
      await w.getByTestId("datei-upload").setInputFiles(path.join(tmp, "tool.exe"));
      await w.getByText(/tool\.exe: Dateityp „\.exe“ ist nicht erlaubt/).waitFor();
      const { rows: [{ ordner }] } = await s.db.pool.query("SELECT ordner FROM projekt WHERE nummer = $1", [`P-${jahr}-001`]);
      assert.ok(fs.existsSync(path.join(s.dataDir, ordner, "Dokumente", "Dateien", "Bühnenplan.pdf")));
      await screenshot(w, "FA-33-projektdateien");
      // FA-29 Kopfkennzahlen
      await w.getByTestId("kennzahlen").getByText("0 / 0").waitFor();
      await screenshot(w, "FA-29-projektdetail");
      // FA-32 globale Aufgabenliste
      await menue.getByText("Aufgaben", { exact: true }).click();
      await w.getByRole("cell", { name: "Genehmigung Ordnungsamt", exact: true }).waitFor();
      await w.getByLabel("Genehmigung Ordnungsamt erledigt").click();
      await w.getByText("Keine Aufgaben.").waitFor();
      // FA-34 Kalender: Balken, Klick öffnet Projekt
      await menue.getByText("Kalender", { exact: true }).click();
      const balken = w.locator(`[data-tag="${monat}-10"] .lp-kalender-balken`).filter({ hasText: `P-${jahr}-001 Stadtfest` });
      await balken.waitFor();
      assert.ok(await w.locator(`[data-tag="${monat}-12"] .lp-kalender-balken`).count() >= 1, "Balken über die Tage");
      await screenshot(w, "FA-34-kalender");
      await balken.click();
      await w.getByRole("heading", { name: `P-${jahr}-001 Stadtfest` }).waitFor();
      // FA-31 Duplizieren
      await w.getByRole("button", { name: "Duplizieren" }).click();
      await w.getByRole("heading", { name: `P-${jahr}-002 Stadtfest (Kopie)` }).waitFor();
      await w.getByText("ohne Termin").first().waitFor();
      await w.getByRole("tab", { name: "Jobs (3)" }).waitFor();
      // Codefeld öffnet Projekt per Nummer
      await w.getByTestId("codefeld").fill(`p-${jahr}-1`);
      await w.getByTestId("codefeld").press("Enter");
      await w.getByRole("heading", { name: `P-${jahr}-001 Stadtfest` }).waitFor();
      // Projektliste mit Filter
      await menue.getByText("Projekte", { exact: true }).click();
      await w.getByLabel("Art").selectOption("job");
      await w.getByRole("cell", { name: `J-${jahr}-001` }).waitFor();
      assert.equal(await w.getByRole("cell", { name: `P-${jahr}-001`, exact: true }).count(), 0);
    } finally { await p.ende(); }
  } finally { await s.ende(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
