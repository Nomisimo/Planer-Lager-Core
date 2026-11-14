import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { starteServer, starteApp, screenshot, anmelden, warteBis } from "./helfer.js";

test("T-01 T-02 T-03 R-73 FA-13 Kabel-Assistent bestellt 3 Etiketten, Lieferung per Scan, Scan vor Lieferung meldet Bestellnummer", async () => {
  const s = await starteServer();
  await s.benutzer("leitung", "Lagerleitung", "Lars Leitung");
  await s.db.pool.query("INSERT INTO kategorie (name, praefix) VALUES ('Stromkabel', 'SK')");
  try {
    const m = await starteApp("materialplaner", s.url);
    try {
      const w = m.win;
      await anmelden(w, "leitung");
      await w.getByRole("navigation", { name: "Hauptmenü" }).getByText("Material", { exact: true }).click();
      await w.getByRole("button", { name: "Kabel-Assistent" }).click();
      // T-01: „Kabel 5 m“, 3 Stück, Etiketten bestellen
      await w.getByLabel("Kabelart").fill("Kabel");
      await w.getByLabel("Kategorie").selectOption({ label: "Stromkabel (SK)" });
      await w.getByLabel("Meterpreis pro Tag (€)").fill("0,50");
      await w.getByLabel("5 m ankreuzen", { exact: true }).check();
      assert.equal(await w.getByLabel("Preis 5 m", { exact: true }).inputValue(), "2,50", "Meterpreis füllt Zeilenpreis vor");
      await w.getByLabel("Stückzahl 5 m", { exact: true }).fill("3");
      // eigene Länge (R-73 „und eigene“): ungültig → Meldung, gültig → neue Zeile mit Preis aus Meterpreis
      await w.getByLabel("Eigene Länge (m)").fill("0");
      await w.getByRole("button", { name: "Länge hinzufügen" }).click();
      await w.getByText("Gib eine Länge größer als 0 ein").waitFor();
      await w.getByLabel("Eigene Länge (m)").fill("12,5");
      await w.getByRole("button", { name: "Länge hinzufügen" }).click();
      assert.equal(await w.getByLabel("Preis 12,5 m", { exact: true }).inputValue(), "6,25");
      await w.getByLabel("12,5 m ankreuzen", { exact: true }).uncheck();
      await w.getByLabel("Kennzeichnung").selectOption("bestellen");
      await screenshot(w, "R-73-kabel-assistent");
      await w.getByRole("button", { name: "1 Kabel-Artikel anlegen" }).click();
      await w.getByRole("heading", { name: /Etiketten-Bestellung EB-\d{4}-001/ }).waitFor();
      for (const c of ["SK-0001", "SK-0002", "SK-0003"]) await w.getByRole("cell", { name: c, exact: true }).waitFor();
      const { rows: [a] } = await s.db.pool.query("SELECT laenge_m, farbcode, (SELECT count(*)::int FROM geraet) AS geraete FROM artikel WHERE name = 'Kabel 5 m'");
      assert.deepEqual([a.laenge_m, !!a.farbcode, a.geraete], [5, true, 0]);
      const nummer = (await w.getByRole("heading", { name: /EB-/ }).textContent()).match(/EB-\d{4}-\d{3}/)[0];
      // T-03: Code einer noch nicht gelieferten Bestellung scannen → rot mit Bestellnummer
      await w.getByTestId("codefeld").fill("sk2");
      await w.getByTestId("codefeld").press("Enter");
      const rot = w.locator(".lp-meldung-error, [data-level='error']").filter({ hasText: nummer });
      await rot.first().waitFor();
      await screenshot(w, "T-03-bestellt-nicht-geliefert");
      // T-02: Lieferung der 3 Codes buchen (Scan + Abhaken)
      await w.goBack();
      await w.getByRole("heading", { name: new RegExp(nummer) }).waitFor();
      await w.getByLabel("Gelieferten Code scannen").fill("sk0001");
      await w.getByLabel("Gelieferten Code scannen").press("Enter");
      await w.getByText("1 Gerät(e) gebucht.").waitFor();
      await w.getByLabel("SK-0002 abhaken").check();
      await w.getByLabel("SK-0003 abhaken").check();
      await w.getByRole("button", { name: "2 abgehakte buchen" }).click();
      await w.getByText("2 Gerät(e) gebucht.").waitFor();
      await w.getByText(/· geliefert$/).waitFor();
      const { rows } = await s.db.pool.query("SELECT code FROM geraet ORDER BY code");
      assert.deepEqual(rows.map((r) => r.code), ["SK-0001", "SK-0002", "SK-0003"]);
      await screenshot(w, "T-02-lieferung-gebucht");
    } finally { await m.ende(); }
  } finally { await s.ende(); }
});

test("FA-10 FA-11 FA-12 R-72 Etikettendruck mit Seitengröße der Vorlage, Designer verschieben/drehen/speichern, Kabelfarben", async () => {
  const s = await starteServer();
  await s.benutzer("leitung", "Lagerleitung");
  await s.db.pool.query("INSERT INTO kategorie (name, praefix) VALUES ('Scheinwerfer', 'SW'), ('DMX-Kabel', 'DK')");
  try {
    const m = await starteApp("materialplaner", s.url);
    try {
      const w = m.win;
      await anmelden(w, "leitung");
      // R-72 qr: Artikel mit 2 Geräten → Etikettendruck öffnet
      await w.getByRole("navigation", { name: "Hauptmenü" }).getByText("Material", { exact: true }).click();
      await w.getByRole("button", { name: "Material aufnehmen" }).click();
      await w.getByLabel("Name").fill("PAR 64");
      await w.getByLabel("Kategorie").selectOption({ label: "Scheinwerfer (SW)" });
      await w.getByLabel("Anzahl Geräte").fill("2");
      await w.getByLabel("Kennzeichnung").selectOption("qr");
      await w.getByRole("button", { name: "Speichern" }).click();
      await w.getByRole("heading", { name: "Etiketten drucken" }).waitFor();
      await w.locator('[data-code="SW-0001"] svg path').waitFor();
      await w.locator('[data-code="SW-0002"]').waitFor();
      await screenshot(w, "FA-10-etikettendruck");
      await w.getByRole("button", { name: "2 drucken" }).click();
      await w.getByText(/2 Etikett\(en\) 62 × 29 mm an den Drucker gesendet/).waitFor();
      const [auftrag] = await warteBis(() => m.druckauftraege().length && m.druckauftraege());
      assert.equal(auftrag.groesse, "62x29");
      const pdf = fs.readFileSync(auftrag.datei).toString("latin1");
      assert.equal((pdf.match(/\/Type\s*\/Page[^s]/g) || []).length, 2, "eine Seite je Etikett");
      // Kabel → Barcode-Vorlage
      await w.evaluate(() => { window.location.hash = "#/material/neu"; });
      await w.getByLabel("Name").fill("DMX 10 m");
      await w.getByLabel("Kategorie").selectOption({ label: "DMX-Kabel (DK)" });
      await w.getByLabel("Anzahl Geräte").fill("1");
      await w.getByRole("button", { name: "Speichern" }).click();
      await w.locator('[data-code="DK-0001"]').waitFor();
      assert.ok(await w.locator('[data-code="DK-0001"] svg rect').count() > 20, "Barcode-Striche");
      assert.match(await w.locator('[data-code="DK-0001"]').innerHTML(), />10 m</);
      // FA-12 Kabelfarben
      await w.getByRole("navigation", { name: "Hauptmenü" }).getByText("Etiketten", { exact: true }).click();
      await w.getByRole("tab", { name: "Kabelfarben" }).click();
      await w.getByRole("cell", { name: "10 m" }).waitFor();
      await w.getByRole("cell", { name: /Rot/ }).waitFor();
      await w.getByRole("button", { name: "Längen aus Namen neu erkennen" }).click();
      await w.getByText(/schon aktuell|aktualisiert/).waitFor();
      // FA-11 Designer: kopieren, verschieben, drehen, speichern
      await w.getByRole("tab", { name: "Vorlagen" }).click();
      await w.locator('[data-vorlage="Standard 62×29"]').getByRole("button", { name: "Kopieren" }).click();
      await w.locator('[data-vorlage="Kopie von Standard 62×29"]').getByRole("button", { name: "Bearbeiten" }).click();
      await w.getByTestId("designer").waitFor();
      const qr = w.getByRole("button", { name: "QR-Code auswählen" });
      const box = await qr.boundingBox();
      await w.mouse.move(box.x + 20, box.y + 20);
      await w.mouse.down();
      await w.mouse.move(box.x + 36, box.y + 20, { steps: 4 });
      await w.mouse.up();
      assert.equal(await w.getByLabel("X (mm)").inputValue(), "4", "2 mm verschoben (8 px/mm), Raster 0,5");
      // Vergrößern über den Griff: +2 mm Breite und Höhe
      const griff = await w.locator(".lp-designer-griff").boundingBox();
      await w.mouse.move(griff.x + 6, griff.y + 6);
      await w.mouse.down();
      await w.mouse.move(griff.x + 22, griff.y + 22, { steps: 4 });
      await w.mouse.up();
      assert.equal(await w.getByLabel("Breite (mm)", { exact: true }).last().inputValue(), "27");
      await w.getByRole("button", { name: "Code (Text) auswählen" }).click();
      await w.getByRole("button", { name: "Drehen" }).click();
      assert.equal(await w.getByLabel("Drehung (Grad)").inputValue(), "90");
      await w.getByRole("button", { name: "Waagrecht zentrieren" }).click();
      await screenshot(w, "FA-11-designer");
      await w.getByRole("button", { name: "Speichern" }).click();
      await w.getByText("Vorlage gespeichert.").waitFor();
      const { rows: [v] } = await s.db.pool.query("SELECT elemente FROM etikett_vorlage WHERE name = 'Kopie von Standard 62×29'");
      assert.deepEqual([v.elemente[0].x, v.elemente[0].b, v.elemente[0].h, v.elemente[1].dreh], [4, 27, 27, 90]);
    } finally { await m.ende(); }
  } finally { await s.ende(); }
});
