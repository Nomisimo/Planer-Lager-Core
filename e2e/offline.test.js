import { test } from "node:test";
import assert from "node:assert/strict";
import { starteServer, starteApp, screenshot, anmelden } from "./helfer.js";

test("FA-22 Offline-Puffer: Scans ohne Verbindung warten sichtbar und werden beim Wiederverbinden in Reihenfolge gebucht", async () => {
  const s = await starteServer();
  const q = (sql, w) => s.db.pool.query(sql, w);
  try {
    await s.benutzer("lager", "Lager / Techniker", "Lars Lager");
    const { rows: [k] } = await q("INSERT INTO kunde (name) VALUES ('Anna Müller') RETURNING id");
    const { rows: [li] } = await q("INSERT INTO kategorie (name, praefix, letzte_nummer) VALUES ('Licht', 'LI', 3) RETURNING id");
    const { rows: [akku] } = await q("INSERT INTO artikel (name, kategorie_id) VALUES ('Akku', $1) RETURNING id", [li.id]);
    for (const c of ["LI-0001", "LI-0002", "LI-0003"]) await q("INSERT INTO geraet (code, artikel_id, letzte_pruefung) VALUES ($1, $2, (now() AT TIME ZONE 'Europe/Berlin')::date)", [c, akku.id]);
    const { rows: [p] } = await q("INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn) VALUES ('P-2027-001', 'projekt', 'Stadtfest', $1, 'bestaetigt', '2027-05-01') RETURNING id", [k.id]);
    const { rows: [a] } = await q("INSERT INTO angebot (nummer, projekt_id, status) VALUES ('A-2027-001', $1, 'angenommen') RETURNING id", [p.id]);
    await q("INSERT INTO angebot_position (angebot_id, pos, art, artikel_id, menge) VALUES ($1, 1, 'miete', $2, 3)", [a.id, akku.id]);
    const app = await starteApp("materialplaner", s.url);
    try {
      const w = app.win;
      await anmelden(w, "lager");
      await w.getByRole("navigation", { name: "Hauptmenü" }).getByText("Code scannen", { exact: true }).click();
      await w.getByLabel("Projekt").selectOption(String(p.id));
      const scanne = async (code) => { await w.getByTestId("scanfeld").fill(code); await w.getByTestId("scanfeld").press("Enter"); };
      const ergebnis = w.getByTestId("scan-ergebnis");
      // Verbindung weg: Scan-Anfragen scheitern auf Netzwerkebene
      await w.route("**/api/v1/scan", (r) => r.abort("internetdisconnected"));
      await scanne("LI-0001");
      await ergebnis.getByText(/Offline: LI-0001 gespeichert.*\(1 wartet\)/).waitFor();
      assert.equal(await ergebnis.getAttribute("data-level"), "warn");
      await scanne("LI-0002");
      await w.getByTestId("offline-warten").getByText("Offline – 2 Scans warten auf die Verbindung.").waitFor();
      await screenshot(w, "FA-22-offline");
      assert.equal((await q("SELECT count(*)::int AS n FROM geraet WHERE status = 'gepackt'")).rows[0].n, 0, "noch nichts gebucht");
      // Neuladen verliert nichts
      await w.reload();
      await w.getByLabel("Projekt").selectOption(String(p.id));
      await w.getByTestId("offline-warten").getByText(/2 Scans warten/).waitFor();
      // Verbindung wieder da: neuer Scan sendet zuerst die wartenden (Reihenfolge)
      await w.unroute("**/api/v1/scan");
      await scanne("LI-0003");
      await ergebnis.getByText("LI-0003 Akku – Gepackt").waitFor();
      await w.getByTestId("offline-warten").waitFor({ state: "detached" });
      await w.getByText(/Nachgebucht \(offline erfasst \d{2}:\d{2}\): LI-0001 Akku – Gepackt/).waitFor();
      const { rows } = await q("SELECT g.code FROM bewegung b JOIN geraet g ON g.id = b.geraet_id ORDER BY b.id");
      assert.deepEqual(rows.map((r) => r.code), ["LI-0001", "LI-0002", "LI-0003"], "in Erfassungsreihenfolge gebucht");
      assert.equal((await q("SELECT count(*)::int AS n FROM scan_offline")).rows[0].n, 2);
    } finally { await app.ende(); }
  } finally { await s.ende(); }
});
