import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { starteServer, starteApp, screenshot, anmelden } from "./helfer.js";

test("T-04 T-05 FA-41 FA-42 FA-43 FA-44 FA-45 Productionplaner: Angebot, Überbuchung, Versenden, Packliste, Kalkulator", async () => {
  const s = await starteServer();
  await s.benutzer("buero", "Büro / Disposition", "Berta Büro");
  const q = (sql, w) => s.db.pool.query(sql, w);
  await q("INSERT INTO kunde (name, firma) VALUES ('Anna Müller', 'Stadtwerke Köln')");
  const { rows: [kat] } = await q("INSERT INTO kategorie (name, praefix, letzte_nummer) VALUES ('Licht', 'LI', 6) RETURNING id");
  const { rows: [akku] } = await q("INSERT INTO artikel (name, kategorie_id, preis_tag, folgetag_prozent) VALUES ('Akku-Spot', $1, 1000, 50) RETURNING id", [kat.id]);
  await q("INSERT INTO artikel (name, kategorie_id, preis_tag, mengenschritt) VALUES ('PAR-Set', $1, 500, 4)", [kat.id]);
  await q("INSERT INTO artikel (name, kategorie_id, ist_leistung, zeitmodell, preis_tag, preis_erweitert) VALUES ('Techniker', $1, true, 'tag', 40000, 50000)", [kat.id]);
  for (let i = 1; i <= 6; i++) await q("INSERT INTO geraet (code, artikel_id) VALUES ($1, $2)", [`LI-000${i}`, akku.id]);
  const jahr = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric" }).format(new Date());
  const naechstes = Number(jahr) + 1;
  try {
    const p = await starteApp("productionplaner", s.url);
    try {
      const w = p.win;
      await anmelden(w, "buero");
      const menue = w.getByRole("navigation", { name: "Hauptmenü" });
      // T-04: Projekt anlegen
      await menue.getByText("Projekte", { exact: true }).click();
      await w.getByRole("button", { name: "Neues Projekt" }).click();
      await w.getByLabel("Name").fill("Stadtfest");
      await w.getByLabel("Kunde").selectOption({ label: "Stadtwerke Köln (Anna Müller)" });
      await w.getByLabel("Beginn").fill(`${naechstes}-06-10`);
      await w.getByLabel("Ende").fill(`${naechstes}-06-12`);
      await w.getByRole("button", { name: "Speichern" }).click();
      await w.getByRole("heading", { name: `P-${jahr}-001 Stadtfest` }).waitFor();
      const { rows: [{ ordner }] } = await q("SELECT ordner FROM projekt WHERE nummer = $1", [`P-${jahr}-001`]);
      for (const u of ["Angebote", "Rechnungen", "Dokumente"]) assert.ok(fs.statSync(path.join(s.dataDir, ordner, u)).isDirectory(), `Unterordner ${u}`);
      // Angebot mit 2 Positionen
      await w.getByRole("tab", { name: /Angebote/ }).click();
      await w.getByRole("button", { name: "Neues Angebot" }).click();
      await w.getByRole("dialog").getByRole("button", { name: "Angebot anlegen" }).click();
      await w.getByRole("heading", { name: new RegExp(`^A-${jahr}-001`) }).waitFor();
      assert.equal(await w.getByLabel("Miettage").inputValue(), "3", "Miettage aus dem Projektzeitraum");
      await w.getByRole("button", { name: "Material hinzufügen" }).click();
      await w.getByLabel("Artikel Position 1").selectOption({ label: "Akku-Spot" });
      await w.getByLabel("Menge Position 1").fill("2");
      await w.getByText("Verfügbar im Zeitraum: 6 von 6").waitFor();
      // FA-41 Mengenschritt-Prüfung
      await w.getByRole("button", { name: "Material hinzufügen" }).click();
      await w.getByLabel("Artikel Position 2").selectOption({ label: "PAR-Set (4er-Set)" });
      await w.getByLabel("Menge Position 2").fill("5");
      await w.getByText(/nur im 4er-Set vermietet\. Nimm 8 statt 5/).waitFor();
      await w.getByLabel("Menge Position 2").fill("4");
      // R-28: 2 × (1 + 2 × 0,5) × 10 € = 40,00 €; 4 × 2 × 5 € = 40,00 €
      await w.getByTestId("summe-1").getByText("40,00 €").waitFor();
      await w.getByTestId("summe-2").getByText("40,00 €").waitFor();
      // Personal mit Zeitrechner: 12 h → 500 € + 2 h × 50 € = 600 €/Tag × 3 Tage
      await w.getByRole("button", { name: "Personal hinzufügen" }).click();
      await w.getByLabel("Artikel Position 3").selectOption({ label: "Techniker" });
      await w.getByLabel("Stunden Position 3").fill("12");
      await w.getByTestId("summe-3").getByText("1.800,00 €").waitFor();
      await w.getByRole("button", { name: "Position 3 entfernen" }).click();
      await w.getByTestId("summen").getByText("80,00 €").first().waitFor();
      await w.getByRole("button", { name: "Speichern" }).click();
      await w.getByText("Gespeichert.").waitFor();
      await screenshot(w, "FA-41-angebotseditor");
      // FA-43 Versenden → Fassung 1, PDF im Ordner, Projekt „Angebot gesendet“
      await w.getByRole("button", { name: "Versenden", exact: true }).click();
      await w.getByRole("dialog").getByRole("button", { name: "Versenden" }).click();
      await w.getByText(/Fassung 1 als PDF abgelegt/).waitFor();
      assert.ok(fs.existsSync(path.join(s.dataDir, ordner, "Angebote", `A-${jahr}-001 Fassung 1.pdf`)));
      await w.getByText("1 (aktuell)").waitFor();
      const { rows: [{ status }] } = await q("SELECT status FROM projekt WHERE nummer = $1", [`P-${jahr}-001`]);
      assert.equal(status, "angebot_gesendet");
      // vorgemerkt (R-24)
      const { rows: res } = await q("SELECT menge::int AS menge, fest FROM reservierung WHERE artikel_id = $1", [akku.id]);
      assert.deepEqual(res, [{ menge: 2, fest: false }], "T-04 Material vorgemerkt");
      // FA-44 Packliste
      await w.getByRole("button", { name: "Packliste" }).click();
      await w.getByRole("heading", { name: `Packliste P-${jahr}-001 Stadtfest` }).waitFor();
      await w.getByText("1 × 4er-Set").waitFor();
      await screenshot(w, "FA-44-packliste");
      // T-05: zweites Projekt im selben Zeitraum fordert mehr als vorhanden
      await menue.getByText("Projekte", { exact: true }).click();
      await w.getByRole("button", { name: "Neues Projekt" }).click();
      await w.getByLabel("Name").fill("Firmenfeier");
      await w.getByLabel("Kunde").selectOption({ label: "Stadtwerke Köln (Anna Müller)" });
      await w.getByLabel("Beginn").fill(`${naechstes}-06-12`);
      await w.getByRole("button", { name: "Speichern" }).click();
      await w.getByRole("heading", { name: `P-${jahr}-002 Firmenfeier` }).waitFor();
      await w.getByRole("tab", { name: /Angebote/ }).click();
      await w.getByRole("button", { name: "Neues Angebot" }).click();
      await w.getByRole("dialog").getByRole("button", { name: "Angebot anlegen" }).click();
      await w.getByRole("heading", { name: new RegExp(`^A-${jahr}-002`) }).waitFor();
      await w.getByRole("button", { name: "Material hinzufügen" }).click();
      await w.getByLabel("Artikel Position 1").selectOption({ label: "Akku-Spot" });
      await w.getByLabel("Menge Position 1").fill("5");
      await w.getByTestId("ueberbuchung").getByText(/Überbucht: 1 fehlen/).waitFor();
      await screenshot(w, "T-05-ueberbuchung");
      await w.getByRole("button", { name: "Speichern" }).click();
      await w.getByText(/Gespeichert\. 1 Position\(en\) überbucht/).waitFor();
      const { rows: [{ n }] } = await q("SELECT count(*)::int AS n FROM angebot_position ap JOIN angebot a ON a.id = ap.angebot_id WHERE a.nummer = $1", [`A-${jahr}-002`]);
      assert.equal(n, 1, "T-05 Speichern bleibt möglich");
      // Angebotsliste
      await menue.getByText("Angebote", { exact: true }).click();
      await w.getByRole("cell", { name: `A-${jahr}-001` }).waitFor();
      await w.getByRole("cell", { name: `A-${jahr}-002` }).waitFor();
      // FA-45 Kalkulator
      await menue.getByText("Kalkulator", { exact: true }).click();
      await w.getByLabel("Kalkulator Artikel 1").selectOption({ label: "Akku-Spot" });
      await w.getByLabel("Tage").fill("4");
      await w.getByLabel("Kalkulator Menge 1").fill("2");
      await w.getByTestId("kalkulator-summen").getByText("50,00 €").first().waitFor(); // FA-41-Beispiel
      // FA-45 Zeitrechner
      await menue.getByText("Zeitrechner", { exact: true }).click();
      await w.getByLabel("Leistung").selectOption({ label: "Techniker" });
      await w.getByLabel("Stunden pro Tag").fill("12");
      await w.getByTestId("zeitrechner-ergebnis").getByText("600,00 €").first().waitFor();
      await w.getByText(/Überstunden: 2 h × 50,00 €/).waitFor();
      await screenshot(w, "FA-45-zeitrechner");
    } finally { await p.ende(); }
  } finally { await s.ende(); }
});
