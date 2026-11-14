import { test } from "node:test";
import assert from "node:assert/strict";
import { starteServer, starteApp, screenshot, anmelden } from "./helfer.js";

test("NFA-03 Productionplaner: Löschfrist sehen, Kandidat in Sicherheit, Kundendaten anonymisieren", async () => {
  const s = await starteServer();
  const q = (sql, w) => s.db.pool.query(sql, w);
  try {
    await s.benutzer("admin", "Administrator", "Ada Admin");
    const { rows: [k] } = await q("INSERT INTO kunde (name, firma, email) VALUES ('Bernd Alt', 'Altfirma GmbH', 'bernd@alt.de') RETURNING id");
    const { rows: [p] } = await q("INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn) VALUES ('P-2012-001', 'projekt', 'Alt', $1, 'abgeschlossen', (now() - interval '12 years')::date) RETURNING id", [k.id]);
    await q("INSERT INTO angebot (projekt_id, nummer, status, datum) VALUES ($1, 'A-2012-001', 'angenommen', (now() - interval '12 years')::date)", [p.id]);
    const pp = await starteApp("productionplaner", s.url);
    try {
      const w = pp.win;
      await anmelden(w, "admin");
      await w.evaluate(() => { location.hash = "#/verwaltung/sicherheit"; });
      await w.getByTestId("loeschfristen").getByText("Altfirma GmbH").click();
      await w.getByTestId("datenschutz").getByText(/Aufbewahrungsfristen sind abgelaufen/).waitFor();
      await w.getByRole("button", { name: "Kundendaten anonymisieren" }).click();
      const d = w.getByRole("dialog");
      assert.equal(await d.getByRole("button", { name: "Anonymisieren" }).isDisabled(), true);
      await d.getByLabel("Bestätigung").fill("ANONYMISIEREN");
      await d.getByRole("button", { name: "Anonymisieren" }).click();
      await w.getByText(/Personenbezogene Daten gelöscht/).first().waitFor();
      await w.getByRole("heading", { name: `Kunde gelöscht (Nr. ${k.id})` }).waitFor();
      assert.equal((await q("SELECT email FROM kunde WHERE id = $1", [k.id])).rows[0].email, "");
      await screenshot(w, "NFA-03-anonymisiert");
    } finally { await pp.ende(); }
  } finally { await s.ende(); }
});
