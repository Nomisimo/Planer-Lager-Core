// FA-37 Personalplanung (Einsatz mit Konfliktwarnung), FA-38 Fahrzeuge (Fahrt, Ladeliste mit Gewicht) in der Oberfläche.
import { test } from "node:test";
import assert from "node:assert/strict";
import { starteServer, starteApp, screenshot, anmelden } from "./helfer.js";

test("FA-37 FA-38 Personal einplanen mit Konflikt, Fahrt mit Ladeliste und Gewichtswarnung", async () => {
  const s = await starteServer();
  await s.benutzer("buero", "Büro / Disposition", "Bea Büro");
  const q = (sql, w) => s.db.pool.query(sql, w);
  const { rows: [k] } = await q("INSERT INTO kunde (name) VALUES ('Anna Müller') RETURNING id");
  const { rows: [a] } = await q("INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn) VALUES ('P-2027-001', 'projekt', 'Stadtfest', $1, 'bestaetigt', '2027-06-10') RETURNING id", [k.id]);
  const { rows: [b] } = await q("INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn) VALUES ('P-2027-002', 'projekt', 'Gala', $1, 'bestaetigt', '2027-06-10') RETURNING id", [k.id]);
  const { rows: [pe] } = await q("INSERT INTO personal (name, qualifikationen) VALUES ('Paul Profi', '{Licht,Rigging}') RETURNING id");
  await q("INSERT INTO einsatz (personal_id, projekt_id, beginn, ende) VALUES ($1, $2, '2027-06-10 10:00+02', '2027-06-10 18:00+02')", [pe.id, a.id]);
  const { rows: [kat] } = await q("INSERT INTO kategorie (name, praefix) VALUES ('Licht', 'LI') RETURNING id");
  const { rows: [art] } = await q("INSERT INTO artikel (name, kategorie_id, gewicht_kg) VALUES ('Spot', $1, 30) RETURNING id", [kat.id]);
  const { rows: [fz] } = await q("INSERT INTO fahrzeug (name, kennzeichen, zuladung_kg) VALUES ('Sprinter', 'B-LP 1', 100) RETURNING id");
  const { rows: [fa] } = await q("INSERT INTO fahrt (fahrzeug_id, projekt_id, abholung, rueckkehr) VALUES ($1, $2, '2027-06-10 08:00+02', '2027-06-10 23:00+02') RETURNING id", [fz.id, b.id]);
  await q("INSERT INTO fahrt_ladung (fahrt_id, artikel_id, menge) VALUES ($1, $2, 4)", [fa.id, art.id]);
  try {
    const p = await starteApp("productionplaner", s.url);
    try {
      const w = p.win;
      await anmelden(w, "buero");
      await w.evaluate((id) => { location.hash = `#/projekte/${id}?tab=ressourcen`; }, b.id);
      await w.getByRole("button", { name: "Personal einplanen" }).click();
      const dlg = w.getByRole("dialog");
      await dlg.getByLabel("Person").selectOption({ label: "Paul Profi (Licht, Rigging)" });
      await dlg.getByLabel("Beginn").fill("2027-06-10T12:00");
      await dlg.getByLabel("Ende").fill("2027-06-10T20:00");
      await dlg.getByRole("button", { name: "Speichern" }).click();
      await dlg.getByText(/P-2027-001/).first().waitFor();
      await screenshot(w, "FA-37-konflikt");
      await dlg.getByRole("button", { name: "Trotzdem eintragen" }).click();
      await w.getByText("Paul Profi für P-2027-002 eingeplant. Trotz Konflikt eingetragen.").waitFor();
      assert.equal((await q("SELECT count(*)::int AS n FROM einsatz WHERE projekt_id = $1 AND konflikt_bestaetigt", [b.id])).rows[0].n, 1);
      await w.getByRole("button", { name: "Ladeliste" }).click();
      await w.getByTestId("ladung-gewicht").getByText("120 kg").waitFor();
      assert.match(await w.getByTestId("ladung-gewicht").innerText(), /120 kg von 100 kg Zuladung/);
      await w.getByRole("dialog").locator(".lp-meldung, [role=alert]").first().waitFor();
      await screenshot(w, "FA-38-ladeliste");
      await w.keyboard.press("Escape");
      await w.evaluate(() => { location.hash = "#/fahrzeuge"; });
      await w.getByRole("cell", { name: /Sprinter/ }).first().waitFor();
      await w.evaluate(() => { location.hash = "#/personal"; });
      await w.getByText("Paul Profi").first().waitFor();
      await screenshot(w, "FA-37-personal");
    } finally { await p.ende(); }
  } finally { await s.ende(); }
});
