import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { starteTestServer } from "./helfer.js";

let s, admin, buero, lager, art, kat, kunde, projekt, angebot;
const q = (sql, w) => s.db.pool.query(sql, w);
const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
before(async () => {
  s = await starteTestServer();
  admin = await s.als("admin", "Administrator");
  buero = await s.als("buero", "Büro / Disposition");
  lager = await s.als("lager", "Lager / Techniker");
  kat = (await q("INSERT INTO kategorie (name, praefix, letzte_nummer) VALUES ('Licht', 'LI', 3) RETURNING id")).rows[0].id;
  art = (await q("INSERT INTO artikel (name, kategorie_id) VALUES ('Spot', $1) RETURNING id", [kat])).rows[0].id;
  for (const n of [1, 2, 3]) await q("INSERT INTO geraet (code, artikel_id, letzte_pruefung) VALUES ($1, $2, (now() AT TIME ZONE 'Europe/Berlin')::date)", [`LI-000${n}`, art]);
  kunde = (await q("INSERT INTO kunde (name) VALUES ('Anna Müller') RETURNING id")).rows[0].id;
  projekt = (await q("INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn) VALUES ('P-2027-001', 'projekt', 'Stadtfest', $1, 'bestaetigt', '2027-05-01') RETURNING id", [kunde])).rows[0].id;
  angebot = (await q("INSERT INTO angebot (nummer, projekt_id, status) VALUES ('A-2027-001', $1, 'angenommen') RETURNING id", [projekt])).rows[0].id;
  await q("INSERT INTO angebot_position (angebot_id, pos, art, artikel_id, menge) VALUES ($1, 1, 'miete', $2, 2)", [angebot, art]);
});
after(() => s?.ende());

test("FA-08 Lagerorte pflegen, Artikel und Gerät zuordnen, Anzeige in der Packliste", async () => {
  assert.equal((await lager("POST", "/api/v1/lagerorte", { name: "Regal A1" })).status, 403, "Lager darf nur lesen");
  const a1 = (await admin("POST", "/api/v1/lagerorte", { name: "Regal A1", bereich: "Halle 1" })).json;
  const b2 = (await admin("POST", "/api/v1/lagerorte", { name: "Regal B2", bereich: "Halle 2" })).json;
  assert.ok(a1.id && b2.id);
  assert.equal((await admin("POST", "/api/v1/lagerorte", { name: "regal a1" })).status, 409, "Name eindeutig");
  assert.equal((await admin("POST", "/api/v1/lagerorte", { name: " " })).status, 400);
  assert.equal((await admin("PUT", `/api/v1/artikel/${art}`, { lagerort_id: a1.id })).status, 200);
  assert.equal((await admin("GET", `/api/v1/artikel/${art}`)).json.lagerort, "Regal A1");
  const g3 = (await admin("GET", "/api/v1/geraete/code/LI-0003")).json;
  assert.equal(g3.lagerort, "Regal A1", "Gerät erbt den Platz des Artikels");
  assert.equal((await admin("PUT", `/api/v1/geraete/${g3.id}`, { lagerort_id: b2.id })).status, 200);
  const g3b = (await admin("GET", `/api/v1/geraete/${g3.id}`)).json;
  assert.equal(g3b.lagerort, "Regal B2");
  assert.equal(g3b.eigener_lagerort, "Regal B2");
  const pl = (await lager("GET", `/api/v1/projekte/${projekt}/packstatus`)).json;
  const z = pl.zeilen.find((x) => x.artikel_id === art);
  assert.equal(z.lagerort, "Regal A1");
  assert.deepEqual(z.lagerorte_weitere, ["Regal B2"]);
  assert.equal((await admin("DELETE", `/api/v1/lagerorte/${a1.id}`)).status, 409, "belegt → nicht löschbar");
  assert.equal((await admin("PUT", `/api/v1/geraete/${g3.id}`, { lagerort_id: null })).status, 200);
  assert.equal((await admin("GET", `/api/v1/geraete/${g3.id}`)).json.lagerort, "Regal A1", "zurück auf Platz des Artikels");
  assert.equal((await admin("DELETE", `/api/v1/lagerorte/${b2.id}`)).status, 200);
  const liste = (await lager("GET", "/api/v1/lagerorte")).json.zeilen;
  assert.deepEqual(liste.map((l) => [l.name, l.artikel]), [["Regal A1", 1]]);
});

test("FA-09 Schaden bei Rückgabe mit Fotos, verknüpft mit Projekt und Kunde, optional defekt gemeldet", async () => {
  const g = (await admin("GET", "/api/v1/geraete/code/LI-0001")).json;
  assert.equal((await lager("POST", `/api/v1/projekte/${projekt}/schaeden`, { code: "LI-0001", beschreibung: "Linse gesprungen" })).status, 409, "Gerät war nie beim Projekt");
  await q("UPDATE geraet SET projekt_id = $1, status = 'zugeordnet' WHERE code IN ('LI-0001', 'LI-0002')", [projekt]);
  assert.equal((await lager("POST", `/api/v1/projekte/${projekt}/schaeden`, { code: "LI-0001" })).status, 400);
  const r = await lager("POST", `/api/v1/projekte/${projekt}/schaeden`, { code: "li1", beschreibung: "Linse gesprungen", defekt: true });
  assert.equal(r.status, 200, r.text);
  assert.match(r.json.text, /Schaden an LI-0001 für P-2027-001 dokumentiert\. Das Gerät ist als defekt gemeldet\./);
  const auth = { Authorization: "Bearer " + lager.token, "Content-Type": "image/png" };
  for (const n of [1, 2]) {
    const up = await fetch(`${s.url}/api/v1/schaeden/${r.json.id}/foto`, { method: "POST", headers: auth, body: png });
    assert.equal((await up.json()).text, `Foto ${n} gespeichert.`);
  }
  const falsch = await fetch(`${s.url}/api/v1/schaeden/${r.json.id}/foto`, { method: "POST", headers: { ...auth, "Content-Type": "text/html" }, body: "<b>x</b>" });
  assert.equal(falsch.status, 415);
  const kl = (await buero("GET", `/api/v1/kunden/${kunde}/schaeden`)).json.zeilen;
  assert.equal(kl.length, 1);
  assert.equal(kl[0].fotos, 2);
  assert.equal(kl[0].projekt_nummer, "P-2027-001");
  assert.ok(kl[0].reparatur_id, "Reparatur verknüpft");
  const bild = await fetch(`${s.url}/api/v1/schaeden/${r.json.id}/foto/2`, { headers: { Authorization: "Bearer " + buero.token } });
  assert.equal(bild.status, 200);
  assert.equal(bild.headers.get("content-type"), "image/png");
  assert.equal((await fetch(`${s.url}/api/v1/schaeden/${r.json.id}/foto/3`, { headers: { Authorization: "Bearer " + buero.token } })).status, 404);
  const gn = (await admin("GET", `/api/v1/geraete/${g.id}`)).json;
  assert.equal(gn.status, "defekt");
  assert.ok(gn.bewegungen.some((b) => b.aktion === "Schaden dokumentiert: Linse gesprungen"));
  // ohne „defekt“: nur Dokumentation (z. B. Kratzer), Gerät bleibt einsatzfähig
  const r2 = await lager("POST", `/api/v1/projekte/${projekt}/schaeden`, { code: "LI-0002", beschreibung: "Kratzer am Gehäuse" });
  assert.equal(r2.json.level, "success");
  assert.equal((await admin("GET", "/api/v1/geraete/code/LI-0002")).json.status, "zugeordnet");
  // Rückgabe-Arbeitsplatz: ohne Projekt, abgeleitet aus der letzten Buchung des (schon zurückgebuchten) Geräts
  await q("UPDATE geraet SET projekt_id = NULL, status = 'lager' WHERE code = 'LI-0002'");
  const g2 = (await admin("GET", "/api/v1/geraete/code/LI-0002")).json;
  await q("INSERT INTO bewegung (geraet_id, projekt_id, aktion) VALUES ($1, $2, 'Zurück im Lager')", [g2.id, projekt]);
  const r3 = await lager("POST", "/api/v1/schaeden", { code: "LI-0002", beschreibung: "Kabel abgeknickt" });
  assert.match(r3.json.text, /für P-2027-001/);
  assert.equal((await lager("POST", "/api/v1/schaeden", { code: "LI-0003", beschreibung: "x" })).status, 409, "nie bei einem Projekt");
  assert.equal((await lager("GET", `/api/v1/projekte/${projekt}/schaeden`)).json.zeilen.length, 3);
});
