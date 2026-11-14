import { test } from "node:test";
import assert from "node:assert/strict";
import { starteServer, starteApp, screenshot, anmelden, warteBis } from "./helfer.js";

test("T-20 FA-46 R-62 R-63 R-64 R-65 Planungszeit: Timer am Projekt, Angebot zählt, Packseite stoppt, Nachbuchen", async () => {
  const s = await starteServer();
  await s.benutzer("buero", "Büro / Disposition", "Berta Büro");
  const q = (sql, w) => s.db.pool.query(sql, w);
  const jahr = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric" }).format(new Date());
  const { rows: [k] } = await q("INSERT INTO kunde (name) VALUES ('Anna Müller') RETURNING id");
  const { rows: [p] } = await q("INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn) VALUES ($1, 'projekt', 'Stadtfest', $2, 'anfrage', '2027-05-01') RETURNING id", [`P-${jahr}-001`, k.id]);
  const { rows: [an] } = await q("INSERT INTO angebot (projekt_id, nummer, betreff) VALUES ($1, $2, 'Technik') RETURNING id", [p.id, `A-${jahr}-001`]);
  const eintraege = async () => (await q("SELECT minuten, quelle, betrag, laeuft_seit FROM zeiteintrag ORDER BY id")).rows;
  try {
    const pp = await starteApp("productionplaner", s.url);
    try {
      const w = pp.win;
      await anmelden(w, "buero");
      await w.evaluate((id) => { location.hash = `#/projekte/${id}`; }, p.id);
      await w.getByRole("button", { name: "Planungszeit starten" }).click();
      await w.getByTestId("timer").getByText(`P-${jahr}-001 · 0:00 h`).waitFor();
      // R-62: Angebot des Projekts zählt als Planung → Timer läuft weiter
      await w.evaluate((id) => { location.hash = `#/angebote/${id}`; }, an.id);
      await w.getByText(`A-${jahr}-001`).first().waitFor();
      await new Promise((r) => setTimeout(r, 1500));
      assert.equal((await eintraege())[0].laeuft_seit !== null, true, "Timer läuft auf dem Angebot weiter");
      await w.getByTestId("timer").waitFor();
      // 12 Minuten zurückdatieren, damit eine buchbare Dauer entsteht (Herzschlag frisch halten)
      await q("UPDATE zeiteintrag SET laeuft_seit = now() - interval '12 minutes', zuletzt_aktiv = now() WHERE laeuft_seit IS NOT NULL");
      await screenshot(w, "T-20-timer");

      // T-20: Sprung in den Materialplaner auf die Packseite stoppt den Timer, Zeit ist vorgemerkt
      const mp = await starteApp("materialplaner", s.url);
      try {
        await anmelden(mp.win, "buero");
        await mp.win.evaluate((id) => { location.hash = `#/projekte/${id}/packen`; }, p.id);
        await warteBis(async () => (await eintraege())[0]?.laeuft_seit === null, { timeout: 8000 });
        await mp.win.getByTestId("zeit-meldung").waitFor();
      } finally { await mp.ende(); }
      const [e] = await eintraege();
      assert.equal(e.quelle, "timer");
      assert.ok(e.minuten >= 11 && e.minuten <= 13, `12 Minuten gebucht, war ${e.minuten}`);
      assert.ok(e.betrag > 0, "Betrag vorgemerkt");
      const { rows: [rp] } = await q("SELECT count(*)::int AS n FROM rechnung_position rp JOIN rechnung r ON r.id = rp.rechnung_id WHERE r.projekt_id = $1 AND r.status = 'entwurf'", [p.id]);
      assert.equal(rp.n, 1, "im Rechnungsentwurf vorgemerkt");
      await w.getByTestId("timer").waitFor({ state: "detached" });

      // FA-46 Auswertung + R-65 Nachbuchen
      await w.getByRole("navigation", { name: "Hauptmenü" }).getByText("Planungszeit", { exact: true }).click();
      await w.getByTestId("zeit-summe").getByText(/Gesamt: 0:1[123] h/).waitFor();
      await w.getByRole("button", { name: "Zeit nachbuchen" }).click();
      await w.getByRole("dialog").getByLabel("Projekt").selectOption(String(p.id));
      await w.getByRole("dialog").getByLabel("Dauer").fill("1:30");
      await w.getByRole("button", { name: "Nachbuchen", exact: true }).click();
      await w.getByText("1:30 h nachgebucht und im Rechnungsentwurf vorgemerkt.").waitFor();
      await w.getByRole("cell", { name: "nachgebucht" }).waitFor();
      assert.equal((await eintraege()).length, 2);
      await screenshot(w, "FA-46-planungszeit");
    } finally { await pp.ende(); }
  } finally { await s.ende(); }
});
