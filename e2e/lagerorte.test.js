// FA-08 Lagerorte (Seite, Anzeige beim Packen), FA-09 Schaden bei Rückgabe mit Foto, Anzeige beim Kunden im Productionplaner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { starteServer, starteApp, screenshot, anmelden } from "./helfer.js";

const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

test("FA-08 FA-09 Lagerort anlegen und beim Packen sehen, Schaden mit Foto bei der Rückgabe", async () => {
  const s = await starteServer();
  await s.benutzer("chef", "Administrator", "Clara Chef");
  await s.benutzer("buero", "Büro / Disposition", "Bea Büro");
  const q = (sql, w) => s.db.pool.query(sql, w);
  const { rows: [k] } = await q("INSERT INTO kunde (name) VALUES ('Anna Müller') RETURNING id");
  const { rows: [kat] } = await q("INSERT INTO kategorie (name, praefix, letzte_nummer) VALUES ('Licht', 'LI', 2) RETURNING id");
  const { rows: [a] } = await q("INSERT INTO artikel (name, kategorie_id) VALUES ('Spot', $1) RETURNING id", [kat.id]);
  for (const n of [1, 2]) await q("INSERT INTO geraet (code, artikel_id, letzte_pruefung) VALUES ($1, $2, (now() AT TIME ZONE 'Europe/Berlin')::date)", [`LI-000${n}`, a.id]);
  const { rows: [p] } = await q("INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn) VALUES ('P-2027-001', 'projekt', 'Stadtfest', $1, 'bestaetigt', '2027-05-01') RETURNING id", [k.id]);
  const { rows: [an] } = await q("INSERT INTO angebot (nummer, projekt_id, status) VALUES ('A-2027-001', $1, 'angenommen') RETURNING id", [p.id]);
  await q("INSERT INTO angebot_position (angebot_id, pos, art, artikel_id, menge) VALUES ($1, 1, 'miete', $2, 2)", [an.id, a.id]);
  try {
    const m = await starteApp("materialplaner", s.url);
    try {
      const w = m.win;
      await anmelden(w, "chef");
      await w.evaluate(() => { location.hash = "#/lagerorte"; });
      await w.getByRole("button", { name: "Lagerort anlegen" }).click();
      await w.getByRole("dialog").getByLabel("Name").fill("Regal A3");
      await w.getByRole("dialog").getByLabel("Bereich").fill("Halle 1");
      await w.getByRole("dialog").getByRole("button", { name: "Speichern" }).click();
      await w.getByText("Lagerort „Regal A3“ angelegt.").waitFor();
      const { rows: [o] } = await q("SELECT id FROM lagerort WHERE name = 'Regal A3'");
      await w.evaluate((id) => { location.hash = `#/material/${id}/bearbeiten`; }, a.id);
      await w.getByLabel("Lagerort").selectOption({ label: "Regal A3 (Halle 1)" });
      await w.getByRole("button", { name: "Speichern" }).first().click();
      await w.getByRole("heading", { name: "Spot", exact: true }).first().waitFor().catch(async () => { throw new Error(`Speichern ohne Wirkung: ${w.url()} · ${(await w.locator(".lp-inhalt").innerText()).replace(/\s+/g, " ").slice(0, 600)}`); });
      await w.getByText("Regal A3").first().waitFor();
      assert.equal((await q("SELECT lagerort_id FROM artikel WHERE id = $1", [a.id])).rows[0].lagerort_id, o.id);
      await w.evaluate((id) => { location.hash = `#/projekte/${id}/packen`; }, p.id);
      await w.getByTestId("lagerort").getByText("Regal A3").waitFor();
      await screenshot(w, "FA-08-packen-lagerort");
      // Gerät war beim Projekt und ist zurück
      await q("UPDATE geraet SET projekt_id = $1, status = 'zugeordnet' WHERE code = 'LI-0001'", [p.id]);
      await w.evaluate((id) => { location.hash = `#/projekte/${id}/rueckgabe`; }, p.id);
      await w.getByRole("button", { name: "Schaden dokumentieren" }).click();
      const dlg = w.getByRole("dialog");
      await dlg.getByLabel("Gerätecode").fill("LI-0001");
      await dlg.getByLabel("Schaden").fill("Linse gesprungen");
      await dlg.getByLabel("Fotos").setInputFiles({ name: "linse.png", mimeType: "image/png", buffer: png });
      await dlg.getByRole("button", { name: "Speichern" }).click();
      await w.getByText(/Schaden an LI-0001 für P-2027-001 dokumentiert\. 1 Foto\(s\) gespeichert\./).waitFor();
      const liste = w.locator(".lp-section").filter({ hasText: "Schäden (1)" });
      await liste.getByRole("cell", { name: "Linse gesprungen" }).waitFor();
      await screenshot(w, "FA-09-schaden-rueckgabe");
    } finally { await m.ende(); }
    const pp = await starteApp("productionplaner", s.url);
    try {
      const w = pp.win;
      await anmelden(w, "buero");
      await w.evaluate((id) => { location.hash = `#/kunden/${id}`; }, k.id);
      const liste = w.locator(".lp-section").filter({ hasText: "Schäden (1)" });
      await liste.getByRole("cell", { name: "P-2027-001 Stadtfest" }).click();
      await w.getByRole("img", { name: "Foto 1 zu LI-0001" }).waitFor();
      await screenshot(w, "FA-09-schaden-kunde");
    } finally { await pp.ende(); }
  } finally { await s.ende(); }
});
