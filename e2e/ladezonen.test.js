import { test } from "node:test";
import assert from "node:assert/strict";
import { starteServer, starteApp, screenshot, anmelden, PW } from "./helfer.js";

test("T-06 T-21 FA-23 R-55 R-56 R-57 R-58 Materialplaner: Ladezonen anlegen, Angebot annehmen → Prioritätsliste, zuweisen, verteilen, Abschluss gibt frei", async () => {
  const s = await starteServer();
  await s.benutzer("chef", "Administrator", "Clara Chef");
  await s.benutzer("buero", "Büro / Disposition", "Bernd Büro");
  const q = (sql, w) => s.db.pool.query(sql, w);
  // Büro arbeitet per API (Productionplaner ist eigener Test)
  const anm = await (await fetch(`${s.url}/api/v1/anmelden`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ benutzername: "buero", passwort: PW }) })).json();
  const buero = async (methode, pfad, body) => (await fetch(`${s.url}${pfad}`, { method: methode, headers: { "Content-Type": "application/json", Authorization: `Bearer ${anm.token}` }, body: body ? JSON.stringify(body) : undefined })).json();
  const kunde = (await buero("POST", "/api/v1/kunden", { name: "Anna Müller" })).kunde;
  const p1 = (await buero("POST", "/api/v1/projekte", { name: "Stadtfest", kunde_id: kunde.id, beginn: "2027-05-01" })).projekt;
  const p2 = (await buero("POST", "/api/v1/projekte", { name: "Messe", kunde_id: kunde.id, beginn: "2027-05-03" })).projekt;
  await q("UPDATE projekt SET status = 'bestaetigt' WHERE id = $1", [p2.id]);
  try {
    const a = await starteApp("materialplaner", s.url);
    try {
      const w = a.win;
      await anmelden(w, "chef");
      await w.getByRole("navigation", { name: "Hauptmenü" }).getByText("Ladezonen", { exact: true }).click();
      await w.getByText(/Noch keine Ladezonen/).waitFor();
      // FA-23 Zonen anlegen (Admin)
      for (const [name, nr] of [["Zone A", "1"], ["Zone B", "2"]]) {
        await w.getByRole("button", { name: "Ladezone anlegen" }).click();
        const d = w.getByRole("dialog");
        await d.getByLabel("Bezeichnung").fill(name);
        await d.getByLabel("Reihenfolge").fill(nr);
        await d.getByRole("button", { name: "Speichern" }).click();
        await w.getByText(`Ladezone ${name} angelegt.`).waitFor();
      }
      const zoneA = w.getByTestId("zone-Zone A");
      await zoneA.getByText("1 frei").waitFor();
      // T-06 Angebot annehmen → Projekt Bestätigt → erscheint in der Prioritätsliste
      const prio = w.locator("section", { has: w.getByRole("heading", { name: "Als Nächstes zu packen" }) });
      assert.equal(await prio.getByText(p1.nummer).count(), 0, "Anfrage steht noch nicht in der Liste");
      const { angebot } = await buero("POST", "/api/v1/angebote", { projekt_id: p1.id });
      const { rows: [kat] } = await q("INSERT INTO kategorie (name, praefix) VALUES ('Licht', 'LI') RETURNING id");
      const { rows: [art] } = await q("INSERT INTO artikel (name, kategorie_id) VALUES ('Spot', $1) RETURNING id", [kat.id]);
      await buero("PUT", `/api/v1/angebote/${angebot.id}`, { positionen: [{ art: "miete", artikel_id: art.id, menge: 2, tage: 1, einzelpreis: 1000 }] });
      await buero("POST", `/api/v1/angebote/${angebot.id}/status`, { status: "versendet" });
      await buero("POST", `/api/v1/angebote/${angebot.id}/status`, { status: "angenommen" });
      assert.equal((await q("SELECT status FROM projekt WHERE id = $1", [p1.id])).rows[0].status, "bestaetigt");
      await prio.getByText(p1.nummer).waitFor(); // live, ohne Neuladen
      const zeilen = await prio.locator("tbody tr").allTextContents();
      assert.ok(zeilen[0].includes(p1.nummer) && zeilen[1].includes(p2.nummer), "R-55 nach Beginn sortiert");
      // R-56 Zone zuweisen → Zone belegt
      await w.getByLabel("Projekt für Zone A").selectOption(String(p1.id));
      await zoneA.locator("..").getByRole("button", { name: "Zuweisen" }).click();
      await w.getByText(`${p1.nummer} ist jetzt in Zone A.`).waitFor();
      await zoneA.getByText("voll").waitFor();
      await zoneA.getByText("1 von 1 Plätzen belegt").waitFor();
      // R-58 automatisch verteilen → p2 in Zone B
      await w.getByRole("button", { name: "Automatisch verteilen" }).click();
      await w.getByText("1 Projekt(e) auf freie Ladezonen verteilt.").waitFor();
      assert.equal((await q("SELECT ladezone_id FROM projekt WHERE id = $1", [p2.id])).rows[0].ladezone_id != null, true);
      await screenshot(w, "FA-23-ladezonen");
      // T-21 Projekt abschließen → Zone sofort frei, Reservierung aufgehoben
      await buero("POST", `/api/v1/projekte/${p1.id}/status`, { status: "laeuft" });
      await buero("POST", `/api/v1/projekte/${p1.id}/status`, { status: "abgeschlossen" });
      await zoneA.getByText("1 frei").waitFor();
      assert.equal((await q("SELECT count(*)::int AS n FROM reservierung WHERE projekt_id = $1", [p1.id])).rows[0].n, 0);
      // R-57 Freigeben per Knopf
      await w.getByTestId("zone-Zone B").locator("..").getByRole("button", { name: "Freigeben" }).click();
      await w.getByText(`Ladezone von ${p2.nummer} freigegeben.`).waitFor();
    } finally { await a.ende(); }
  } finally { await s.ende(); }
});
