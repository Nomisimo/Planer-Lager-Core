import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { starteTestServer } from "./helfer.js";

let s, lager, buero;
const q = (sql, w) => s.db.pool.query(sql, w);
before(async () => {
  s = await starteTestServer();
  lager = await s.als("lager", "Lager / Techniker");
  buero = await s.als("buero", "Büro / Disposition");
});
after(() => s?.ende());

const pdfText = async (pfad) => {
  const r = await fetch(s.url + pfad, { headers: { Authorization: "Bearer " + lager.token } });
  assert.equal(r.headers.get("content-type"), "application/pdf");
  return Buffer.from(await r.arrayBuffer());
};

test("FA-20 FA-21 Nachpacken mit erneutem Verladen ohne Buchungsverlust, Verlauf je Durchgang, Lieferschein und Rückgabeprotokoll", async () => {
  const { rows: [k] } = await q("INSERT INTO kunde (name, firma) VALUES ('Anna Müller', 'Stadtwerke') RETURNING id");
  const { rows: [kat] } = await q("INSERT INTO kategorie (name, praefix, letzte_nummer) VALUES ('Licht', 'LI', 4) RETURNING id");
  const { rows: [a] } = await q("INSERT INTO artikel (name, kategorie_id) VALUES ('Spot', $1) RETURNING id", [kat.id]);
  for (const n of [1, 2, 3, 4]) await q("INSERT INTO geraet (code, artikel_id, seriennummer, letzte_pruefung) VALUES ($1, $2, $3, (now() AT TIME ZONE 'Europe/Berlin')::date)", [`LI-000${n}`, a.id, `SN-${n}`]);
  const { rows: [p] } = await q("INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn) VALUES ('P-2027-001', 'projekt', 'Stadtfest', $1, 'bestaetigt', '2027-05-01') RETURNING id", [k.id]);
  const scan = (code, modus = "packen") => lager("POST", "/api/v1/scan", { code, modus, projekt: modus === "rueckgabe" ? null : p.id });
  await scan("LI-0001"); await scan("LI-0002");
  const v1 = await lager("POST", `/api/v1/projekte/${p.id}/verladen`, {});
  assert.match(v1.json.text, /Lieferschein steht bereit/);
  // Nachlieferung: wieder öffnen, nachpacken, erneut verladen – bestehende Buchungen bleiben
  await lager("POST", `/api/v1/projekte/${p.id}/packen-oeffnen`, {});
  assert.equal((await q("SELECT count(*)::int AS n FROM geraet WHERE projekt_id = $1 AND status = 'gepackt'", [p.id])).rows[0].n, 2, "Öffnen verliert nichts");
  await scan("LI-0003");
  const v2 = await lager("POST", `/api/v1/projekte/${p.id}/verladen`, {});
  assert.match(v2.json.text, /Nachlieferung 1: 1 Gerät\(e\) neu/);
  // Teilrückgabe 1: LI-0001 ok, LI-0002 mit Mangel
  await scan("LI-0001", "rueckgabe");
  await scan("LI-0002", "rueckgabe");
  await lager("POST", "/api/v1/pruefung", { code: "LI-0002", ergebnis: "mangel", notiz: "Linse gesprungen" });
  const r1 = await lager("POST", `/api/v1/projekte/${p.id}/rueckgabe-abschliessen`, {});
  assert.match(r1.json.text, /Rückgabe 1 abgeschlossen: 2 zurück, 1 fehlen, 1 defekt/);
  assert.equal((await lager("POST", `/api/v1/projekte/${p.id}/rueckgabe-abschliessen`, {})).json.text, "Rückgabe 2 abgeschlossen: 0 zurück, 1 fehlen, 0 defekt. Das Rückgabeprotokoll steht bereit.");
  await scan("LI-0003", "rueckgabe");
  const r3 = await lager("POST", `/api/v1/projekte/${p.id}/rueckgabe-abschliessen`, {});
  assert.match(r3.json.text, /1 zurück, 0 fehlen, 0 defekt/);
  assert.equal((await lager("POST", `/api/v1/projekte/${p.id}/rueckgabe-abschliessen`, {})).status, 409, "nichts mehr offen");
  // Verlauf: Zeit, Person, Anzahl
  const v = (await buero("GET", `/api/v1/projekte/${p.id}/durchgaenge`)).json.zeilen;
  assert.deepEqual(v.map((d) => [d.art, d.nr, d.anzahl, d.neu, d.fehlt, d.defekt]).reverse(),
    [["verladen", 1, 2, 0, 0, 0], ["verladen", 2, 3, 1, 0, 0], ["rueckgabe", 1, 2, 0, 1, 1], ["rueckgabe", 2, 0, 0, 1, 0], ["rueckgabe", 3, 1, 0, 0, 0]]);
  assert.ok(v.every((d) => d.von && d.zeit));
  // Belege
  const ids = Object.fromEntries(v.map((d) => [`${d.art}${d.nr}`, d.id]));
  const ls = await pdfText(`/api/v1/durchgaenge/${ids.verladen2}/pdf`);
  assert.equal(ls.subarray(0, 5).toString(), "%PDF-");
  const rp = await pdfText(`/api/v1/durchgaenge/${ids.rueckgabe1}/pdf?download=1`);
  assert.ok(rp.length > 1000);
  const { rows: [d1] } = await q("SELECT geraete, fehlt, defekt FROM projekt_durchgang WHERE id = $1", [ids.rueckgabe1]);
  assert.deepEqual([d1.geraete.map((g) => g.code), d1.fehlt.map((g) => g.code), d1.defekt.map((g) => [g.code, g.mangel_text])],
    [["LI-0001", "LI-0002"], ["LI-0003"], [["LI-0002", "Linse gesprungen"]]]);
  const { rows: [l2] } = await q("SELECT geraete FROM projekt_durchgang WHERE id = $1", [ids.verladen2]);
  assert.deepEqual(l2.geraete.map((g) => [g.code, g.seriennummer, g.neu]), [["LI-0001", "SN-1", false], ["LI-0002", "SN-2", false], ["LI-0003", "SN-3", true]]);
  await assert.rejects(q("DELETE FROM projekt_durchgang WHERE id = $1", [ids.verladen1]), "Verlauf unveränderlich");
});
