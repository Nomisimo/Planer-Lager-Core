import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { starteTestServer } from "./helfer.js";

let s, admin, buero;
const q = (sql, w) => s.db.pool.query(sql, w);
before(async () => {
  s = await starteTestServer();
  admin = await s.als("admin10", "Administrator");
  buero = await s.als("buero", "Büro / Disposition");
});
after(async () => { await s.ende(); });

test("NFA-03 Löschkonzept: ohne Projekte löschen, mit Belegen erst nach Frist anonymisieren, Datenauskunft, nur Admin", async () => {
  const neu = async (name) => (await q("INSERT INTO kunde (name, firma, email, telefon, strasse, ort) VALUES ($1, 'Firma', 'a@b.de', '0221', 'Weg 1', 'Köln') RETURNING id", [name])).rows[0].id;
  const ohne = await neu("Ohne Projekt");
  assert.equal((await buero("GET", `/api/v1/kunden/${ohne}/datenschutz`)).json.loeschen, true);
  // Projekt + Angebot vor 3 Jahren → Frist läuft noch
  const jung = await neu("Anna Müller");
  const { rows: [p] } = await q("INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn) VALUES ('P-2023-001', 'projekt', 'Fest', $1, 'abgeschlossen', (now() - interval '3 years')::date) RETURNING id", [jung]);
  await q("INSERT INTO angebot (projekt_id, nummer, status, datum) VALUES ($1, 'A-2023-001', 'angenommen', (now() - interval '3 years')::date)", [p.id]);
  const d = (await buero("GET", `/api/v1/kunden/${jung}/datenschutz`)).json;
  assert.equal(d.anonymisieren, false);
  assert.match(d.text, /Aufbewahrungspflicht bis 01\.01\.\d{4}/);
  assert.equal((await admin("POST", `/api/v1/kunden/${jung}/anonymisieren`, { bestaetigung: "ANONYMISIEREN" })).status, 409);
  // Alter Kunde: alles älter als 11 Jahre → anonymisieren erlaubt
  const alt = await neu("Bernd Alt");
  const { rows: [p2] } = await q("INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn) VALUES ('P-2012-001', 'projekt', 'Alt', $1, 'abgeschlossen', (now() - interval '12 years')::date) RETURNING id", [alt]);
  await q("INSERT INTO angebot (projekt_id, nummer, status, datum) VALUES ($1, 'A-2012-001', 'angenommen', (now() - interval '12 years')::date)", [p2.id]);
  await q("INSERT INTO rechnung (projekt_id, status, erstellt) VALUES ($1, 'fertig', now() - interval '12 years')", [p2.id]);
  assert.deepEqual((await admin("GET", "/api/v1/verwaltung/loeschfristen")).json.map((k) => k.id), [alt]);
  // Datenauskunft (Art. 15)
  const a = await buero("GET", `/api/v1/kunden/${alt}/auskunft`);
  assert.match(a.headers.get("content-disposition"), /Datenauskunft-Kunde-\d+\.json/);
  assert.equal(a.json.kunde.email, "a@b.de");
  assert.equal(a.json.angebote[0].nummer, "A-2012-001");
  // Anonymisieren: nur Admin, nur mit Bestätigung
  assert.equal((await buero("POST", `/api/v1/kunden/${alt}/anonymisieren`, { bestaetigung: "ANONYMISIEREN" })).status, 403);
  assert.equal((await admin("POST", `/api/v1/kunden/${alt}/anonymisieren`, {})).status, 400);
  assert.equal((await admin("POST", `/api/v1/kunden/${alt}/anonymisieren`, { bestaetigung: "ANONYMISIEREN" })).json.ok, true);
  const { rows: [k] } = await q("SELECT name, firma, email, telefon, strasse, ort, anonymisiert FROM kunde WHERE id = $1", [alt]);
  assert.deepEqual({ ...k, anonymisiert: !!k.anonymisiert }, { name: `Kunde gelöscht (Nr. ${alt})`, firma: "", email: "", telefon: "", strasse: "", ort: "", anonymisiert: true });
  assert.equal((await q("SELECT count(*)::int AS n FROM projekt WHERE kunde_id = $1", [alt])).rows[0].n, 1, "Belege bleiben");
  assert.equal((await admin("POST", `/api/v1/kunden/${alt}/anonymisieren`, { bestaetigung: "ANONYMISIEREN" })).status, 409);
  assert.equal((await admin("GET", "/api/v1/verwaltung/loeschfristen")).json.length, 0);
});
