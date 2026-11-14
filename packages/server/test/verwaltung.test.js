import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { starteTestServer, PW } from "./helfer.js";

let s, admin;
before(async () => { s = await starteTestServer(); admin = await s.als("admin"); });
after(async () => { await s.ende(); });

test("FA-48 Einstellungen: genau ein Datensatz, Standardwerte, Speichern mit Prüfung", async () => {
  const e = await admin("GET", "/api/v1/verwaltung/einstellungen");
  assert.equal(e.json.angebot_gueltig_tage, 14);
  const f = await admin("PUT", "/api/v1/verwaltung/einstellungen", { angebot_gueltig_tage: 0 });
  assert.equal(f.status, 400);
  assert.ok(f.json.felder.angebot_gueltig_tage);
  const ok = await admin("PUT", "/api/v1/verwaltung/einstellungen", { angebot_gueltig_tage: 21, firma: { name: "Verleih GmbH" } });
  assert.equal(ok.status, 200);
  await admin("PUT", "/api/v1/verwaltung/einstellungen", { firma: { ort: "Köln" } });
  const b = await admin("GET", "/api/v1/einstellungen/basis");
  assert.equal(b.json.firma.name, "Verleih GmbH", "Teiländerung behält andere Firmenfelder");
  await assert.rejects(s.db.pool.query("INSERT INTO einstellungen (id) VALUES (2)"));
});

test("R-06 Rollen: eigene Rolle anlegen, Rechte setzen, eingebaute Rollen nicht löschbar", async () => {
  const r = await admin("POST", "/api/v1/verwaltung/rollen", { name: "Aushilfe", rechte: { packen: "w", material: "r", verwaltung: "x" } });
  assert.equal(r.status, 200);
  assert.equal(r.json.rechte.packen, "w");
  assert.equal(r.json.rechte.verwaltung, "", "ungültige Stufe wird verworfen");
  const liste = (await admin("GET", "/api/v1/verwaltung/rollen")).json;
  const eingebaut = liste.find((x) => x.name === "Lagerleitung");
  const d = await admin("DELETE", `/api/v1/verwaltung/rollen/${eingebaut.id}`);
  assert.equal(d.status, 409);
  assert.match(d.json.text, /eingebaute Rolle/);
  assert.equal((await admin("DELETE", `/api/v1/verwaltung/rollen/${r.json.id}`)).status, 200);
});

test("R-07 letzter Administrator: Herabstufen, Deaktivieren, Löschen wird verhindert", async () => {
  const rollen = (await admin("GET", "/api/v1/verwaltung/rollen")).json;
  const adminRolle = rollen.find((x) => x.name === "Administrator");
  const lagerRolle = rollen.find((x) => x.name === "Lager / Techniker");
  const ich = (await admin("GET", "/api/v1/ich")).json.nutzer;
  assert.equal((await admin("PUT", `/api/v1/verwaltung/benutzer/${ich.id}`, { rolle_id: lagerRolle.id })).status, 409);
  assert.equal((await admin("PUT", `/api/v1/verwaltung/benutzer/${ich.id}`, { aktiv: false })).status, 409);
  assert.equal((await admin("DELETE", `/api/v1/verwaltung/benutzer/${ich.id}`)).status, 409);
  assert.equal((await admin("PUT", `/api/v1/verwaltung/rollen/${adminRolle.id}`, { rechte: { verwaltung: "" } })).status, 409);
  const n = await admin("POST", "/api/v1/verwaltung/benutzer", { benutzername: "admin2", passwort: PW, rolle_id: adminRolle.id });
  assert.equal(n.status, 200);
  assert.equal((await admin("PUT", `/api/v1/verwaltung/benutzer/${n.json.id}`, { rolle_id: lagerRolle.id })).status, 200);
});

test("R-09 Benutzer anlegen prüft Passwortregeln; Passwort nur als Hash gespeichert", async () => {
  const rollen = (await admin("GET", "/api/v1/verwaltung/rollen")).json;
  const r = await admin("POST", "/api/v1/verwaltung/benutzer", { benutzername: "neu1", passwort: "1234567890", rolle_id: rollen[0].id });
  assert.equal(r.status, 400);
  assert.match(r.json.felder.passwort, /Ziffern/);
  const ok = await admin("POST", "/api/v1/verwaltung/benutzer", { benutzername: "neu1", passwort: PW, rolle_id: rollen[0].id });
  assert.equal(ok.status, 200);
  const { rows } = await s.db.pool.query("SELECT passwort_hash FROM benutzer WHERE benutzername = 'neu1'");
  assert.match(rows[0].passwort_hash, /^scrypt\$/);
  assert.ok(!rows[0].passwort_hash.includes(PW));
});
