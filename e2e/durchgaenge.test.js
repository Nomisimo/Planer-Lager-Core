// FA-20 Nachpacken / Teilrückgaben mit Verlauf, FA-21 Lieferschein und Rückgabeprotokoll in der Oberfläche.
import { test } from "node:test";
import assert from "node:assert/strict";
import { starteServer, starteApp, screenshot, anmelden } from "./helfer.js";

test("FA-20 FA-21 Verladen, Nachlieferung, Teilrückgabe mit Verlauf und Belegen", async () => {
  const s = await starteServer();
  await s.benutzer("lager", "Lager / Techniker", "Lars Lager");
  const q = (sql, w) => s.db.pool.query(sql, w);
  const { rows: [k] } = await q("INSERT INTO kunde (name) VALUES ('Anna Müller') RETURNING id");
  const { rows: [kat] } = await q("INSERT INTO kategorie (name, praefix, letzte_nummer) VALUES ('Licht', 'LI', 3) RETURNING id");
  const { rows: [a] } = await q("INSERT INTO artikel (name, kategorie_id) VALUES ('Spot', $1) RETURNING id", [kat.id]);
  for (const n of [1, 2, 3]) await q("INSERT INTO geraet (code, artikel_id, letzte_pruefung) VALUES ($1, $2, (now() AT TIME ZONE 'Europe/Berlin')::date)", [`LI-000${n}`, a.id]);
  const { rows: [p] } = await q("INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn) VALUES ('P-2027-001', 'projekt', 'Stadtfest', $1, 'bestaetigt', '2027-05-01') RETURNING id", [k.id]);
  try {
    const m = await starteApp("materialplaner", s.url);
    try {
      const w = m.win;
      await anmelden(w, "lager");
      const scanne = async (code, text) => { await w.getByTestId("scanfeld").fill(code); await w.getByTestId("scanfeld").press("Enter"); await w.getByTestId("scan-ergebnis").getByText(text).waitFor(); };
      const verladen = async () => {
        await w.getByRole("button", { name: "Packen abgeschlossen & verladen" }).click();
        await w.getByRole("dialog").getByRole("button", { name: "Verladen" }).click();
      };
      await w.evaluate((id) => { location.hash = `#/projekte/${id}/packen`; }, p.id);
      await scanne("LI-0001", "LI-0001 Spot – Gepackt");
      await scanne("LI-0002", "LI-0002 Spot – Gepackt");
      await verladen();
      await w.getByText(/Lieferschein steht bereit/).waitFor();
      const verlauf = w.locator(".lp-section").filter({ hasText: "Verlauf (Verladen und Rückgaben)" });
      await verlauf.getByRole("cell", { name: "2 übergeben" }).waitFor();
      await w.getByRole("button", { name: "Packen wieder öffnen" }).click();
      await scanne("LI-0003", "LI-0003 Spot – Gepackt");
      await verladen();
      await w.getByText(/Nachlieferung 1: 1 Gerät\(e\) neu/).waitFor();
      await verlauf.getByRole("cell", { name: "Nachlieferung 1" }).waitFor();
      await verlauf.getByRole("cell", { name: "3 übergeben · 1 neu" }).waitFor();
      assert.equal(await verlauf.getByRole("button", { name: "Lieferschein" }).count(), 2);
      await screenshot(w, "FA-20-verlauf-packen");
      // Teilrückgabe
      await w.getByRole("button", { name: "Rückgabe" }).click();
      await w.getByRole("heading", { name: "Rückgabe P-2027-001 Stadtfest" }).waitFor();
      await scanne("LI-0001", /LI-0001 Spot – Zurück im Lager/);
      await w.getByRole("button", { name: "Rückgabe abschließen" }).click();
      await w.getByRole("dialog").getByRole("button", { name: "Abschließen" }).click();
      await w.getByText("Rückgabe 1 abgeschlossen: 1 zurück, 2 fehlen, 0 defekt. Das Rückgabeprotokoll steht bereit.").waitFor();
      const v2 = w.locator(".lp-section").filter({ hasText: "Verlauf (Verladen und Rückgaben)" });
      await v2.getByRole("cell", { name: "1 zurück · 2 fehlen · 0 defekt" }).waitFor();
      await v2.getByRole("button", { name: "Rückgabeprotokoll" }).waitFor();
      await screenshot(w, "FA-21-rueckgabeprotokoll");
      assert.equal((await q("SELECT count(*)::int AS n FROM projekt_durchgang WHERE projekt_id = $1", [p.id])).rows[0].n, 3);
    } finally { await m.ende(); }
  } finally { await s.ende(); }
});
