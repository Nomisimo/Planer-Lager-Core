import { test } from "node:test";
import assert from "node:assert/strict";
import { starteServer, starteApp, screenshot, anmelden, warteBis } from "./helfer.js";

test("FA-53 Materialplaner: Plan-Symbole je Artikel sehen und ändern, Bibliothek folgt", async () => {
  const s = await starteServer();
  try {
    await s.benutzer("lagerchef", "Lagerleitung", "Lea Leitung");
    const { rows: [k] } = await s.db.pool.query("INSERT INTO kategorie (name, praefix) VALUES ('Ton', 'TO') RETURNING id");
    await s.db.pool.query("INSERT INTO artikel (name, kategorie_id) VALUES ('Shure SM58', $1), ('d&b E8 Top', $1)", [k.id]);
    const m = await starteApp("materialplaner", s.url);
    try {
      const w = m.win;
      await anmelden(w, "lagerchef");
      await w.getByRole("navigation", { name: "Hauptmenü" }).getByText("Plan-Symbole", { exact: true }).click();
      await w.getByAltText("Symbol Mikrofon").waitFor();
      await w.getByAltText("Symbol Lautsprecher").waitFor();
      await w.getByLabel("Symbol für d&b E8 Top").selectOption("monitor");
      await w.getByText(/Symbol für „d&b E8 Top“ gespeichert/).waitFor();
      await w.getByAltText("Symbol Bühnenmonitor").waitFor();
      assert.equal((await s.db.pool.query("SELECT plansymbol FROM artikel WHERE name = 'd&b E8 Top'")).rows[0].plansymbol, "monitor");
      const g = await warteBis(async () => {
        const r = await fetch(`${s.url}/api/v1/plansymbole`, { headers: { Authorization: `Bearer ${(await (await fetch(`${s.url}/api/v1/anmelden`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ benutzername: "lagerchef", passwort: "Sicheres-Testpasswort-1" }) })).json()).token}` } });
        const j = await r.json();
        return j.bibliothek && j;
      });
      assert.ok(g.bibliothek, "Symbolbibliothek erzeugt");
      await screenshot(w, "FA-53-plansymbole");
    } finally { await m.ende(); }
  } finally { await s.ende(); }
});
