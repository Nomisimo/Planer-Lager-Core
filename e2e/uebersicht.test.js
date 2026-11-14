import { test } from "node:test";
import assert from "node:assert/strict";
import { starteServer, starteApp, screenshot, anmelden, warteBis } from "./helfer.js";

test("FA-35 FA-36 Startseite mit Kacheln/Diese Woche/meine Aufgaben, Suche nach Rolle, Treffer der anderen App per Deep-Link", async () => {
  const s = await starteServer();
  const q = (sql, w) => s.db.pool.query(sql, w);
  try {
    await s.benutzer("buero", "Büro / Disposition", "Berta Büro");
    await s.benutzer("lager", "Lager / Techniker", "Lars Lager");
    const { rows: [k] } = await q("INSERT INTO kunde (name, firma) VALUES ('Anna Müller', 'Stadtwerke Köln') RETURNING id");
    const { rows: [p] } = await q(`INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn, ende) VALUES ('P-2027-001', 'projekt', 'Stadtfest', $1, 'laeuft',
      (now() AT TIME ZONE 'Europe/Berlin')::date + 1, (now() AT TIME ZONE 'Europe/Berlin')::date + 3) RETURNING id`, [k.id]);
    const { rows: [kat] } = await q("INSERT INTO kategorie (name, praefix, letzte_nummer) VALUES ('Licht', 'LI', 1) RETURNING id");
    const { rows: [a] } = await q("INSERT INTO artikel (name, kategorie_id) VALUES ('Stadtfest-Scheinwerfer', $1) RETURNING id", [kat.id]);
    await q("INSERT INTO geraet (code, artikel_id, status, projekt_id) VALUES ('LI-0001', $1, 'gepackt', $2)", [a.id, p.id]);
    const { rows: [b] } = await q("SELECT id FROM benutzer WHERE benutzername = 'buero'");
    await q("INSERT INTO aufgabe (projekt_id, text, zugewiesen_id) VALUES ($1, 'Rigging klären', $2)", [p.id, b.id]);
    const pp = await starteApp("productionplaner", s.url);
    try {
      const w = pp.win;
      await anmelden(w, "buero");
      await w.locator('[data-kachel="laufend"]').getByText("1", { exact: true }).waitFor();
      await w.getByTestId("woche-starts").getByText("P-2027-001 Stadtfest").waitFor();
      await w.getByTestId("woche-rueckgaben").getByText(/1 Geräte draußen/).waitFor();
      await w.getByTestId("meine-aufgaben").getByText(/Rigging klären/).waitFor();
      await screenshot(w, "FA-35-start-productionplaner");
      // Schnellzugriff
      await w.getByRole("heading", { name: "Schnellzugriff" }).locator("xpath=../..").getByRole("button", { name: "Kalender" }).click();
      await w.getByRole("heading", { name: "Kalender", exact: true }).first().waitFor();
      await w.getByRole("navigation", { name: "Hauptmenü" }).getByText("Suche", { exact: true }).click();
      await w.getByLabel("Suchbegriff").fill("stadtfest");
      await w.getByRole("button", { name: "Suchen" }).click();
      await w.locator('[data-gruppe="projekte"]').getByText("P-2027-001 Stadtfest").waitFor();
      await screenshot(w, "FA-36-suche");
      await w.locator('[data-gruppe="material"]').getByText("Stadtfest-Scheinwerfer").click();
      const link = await warteBis(() => pp.externeLinks().find((l) => l.startsWith("materialplaner://")));
      assert.match(link, /material\/\d+/);
      await w.locator('[data-gruppe="projekte"]').getByText("P-2027-001 Stadtfest").click();
      await w.getByRole("heading", { name: /P-2027-001/ }).first().waitFor();
    } finally { await pp.ende(); }
    const mp = await starteApp("materialplaner", s.url);
    try {
      const w = mp.win;
      await anmelden(w, "lager");
      await w.locator('[data-kachel="draussen"]').getByText("1", { exact: true }).waitFor();
      assert.equal(await w.locator('[data-kachel="angebote"]').count(), 0, "Lager sieht keine Angebote");
      await screenshot(w, "FA-35-start-materialplaner");
      await w.evaluate(() => { location.hash = "#/suche?q=K%C3%B6ln"; });
      await w.locator('[data-gruppe="projekte"]').getByText("P-2027-001 Stadtfest").waitFor();
      assert.equal(await w.locator('[data-gruppe="kunden"]').count(), 0, "Lager sieht keine Kunden");
    } finally { await mp.ende(); }
  } finally { await s.ende(); }
});
