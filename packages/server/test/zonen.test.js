import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { starteTestServer } from "./helfer.js";

let s, admin, buero, lager, anzeige, kunde;
const q = (sql, w) => s.db.pool.query(sql, w);
before(async () => {
  s = await starteTestServer();
  admin = await s.als("admin4", "Administrator");
  buero = await s.als("buero", "Büro / Disposition");
  lager = await s.als("lager", "Lager / Techniker");
  anzeige = await s.als("tv", "Anzeige (Bildschirm)");
  kunde = (await buero("POST", "/api/v1/kunden", { name: "Anna Müller" })).json.kunde;
});
after(async () => { await s.ende(); });

const projekt = async (name, beginn, status = "bestaetigt") => {
  const p = (await buero("POST", "/api/v1/projekte", { name, kunde_id: kunde.id, beginn })).json.projekt;
  await q("UPDATE projekt SET status = $1 WHERE id = $2", [status, p.id]);
  return p;
};
const zone = async (bezeichnung, w = {}) => (await admin("POST", "/api/v1/verwaltung/zonen", { bezeichnung, plaetze: 1, ...w })).json;
const zoneVon = async (id) => (await q("SELECT ladezone_id, zone_seit FROM projekt WHERE id = $1", [id])).rows[0];

test("FA-23 3.10 Ladezonen verwalten nur Admin; Name eindeutig; belegt/frei", async () => {
  assert.equal((await lager("POST", "/api/v1/verwaltung/zonen", { bezeichnung: "X" })).status, 403);
  const a = await zone("Zone A", { plaetze: 2, flaeche_m2: "40,5", reihenfolge: 1 });
  assert.equal(a.ok, true);
  const d = await admin("POST", "/api/v1/verwaltung/zonen", { bezeichnung: "zone a" });
  assert.equal(d.status, 409);
  assert.match(d.json.text, /gibt es schon/);
  const f = await admin("POST", "/api/v1/verwaltung/zonen", { bezeichnung: "", plaetze: 0 });
  assert.deepEqual(Object.keys(f.json.felder).sort(), ["bezeichnung", "plaetze"]);
  const l = (await lager("GET", "/api/v1/zonen")).json.zonen;
  assert.deepEqual([l[0].bezeichnung, l[0].plaetze, l[0].flaeche_m2, l[0].belegt, l[0].frei], ["Zone A", 2, 40.5, 0, 2]);
  assert.equal((await admin("PUT", `/api/v1/verwaltung/zonen/${a.id}`, { bezeichnung: "Zone A", plaetze: 2, aktiv: true, reihenfolge: 1, beschreibung: "Rampe links" })).json.ok, true);
  await q("DELETE FROM ladezone");
});

test("R-55 Prioritätsliste „Als Nächstes zu packen“", async () => {
  const p1 = await projekt("Später", "2027-06-10");
  const p2 = await projekt("Früher", "2027-06-01", "laeuft");
  const p3 = await projekt("Ohne Termin", null);
  await projekt("Anfrage", "2027-05-01", "anfrage");
  const p5 = await projekt("Gepackt", "2027-05-01", "laeuft");
  await q("UPDATE projekt SET gepackt_am = now() WHERE id = $1", [p5.id]);
  const z = (await lager("GET", "/api/v1/zonen/prioritaet")).json.zeilen.map((x) => x.id);
  assert.deepEqual(z, [p2.id, p1.id, p3.id]);
  await q("UPDATE projekt SET status = 'abgeschlossen'");
});

test("R-56 R-57 T-21 Zuweisen/Freigeben: aktiv, nicht voll, schon drin → nichts, zone_seit; nur mit Recht zonen w", async () => {
  const a = await zone("Zone B");
  const zu = await zone("Zone Z", { aktiv: false });
  const p1 = await projekt("Eins", "2027-07-01");
  const p2 = await projekt("Zwei", "2027-07-02");
  assert.equal((await lager("POST", `/api/v1/zonen/${a.id}/zuweisen`, { projekt: p1.id })).status, 403, "Lager hat zonen nur lesen");
  const r = await admin("POST", `/api/v1/zonen/${a.id}/zuweisen`, { projekt: p1.id });
  assert.equal(r.json.ok, true);
  assert.equal((await zoneVon(p1.id)).ladezone_id, a.id);
  assert.ok((await zoneVon(p1.id)).zone_seit);
  assert.equal((await admin("POST", `/api/v1/zonen/${a.id}/zuweisen`, { projekt: p1.id })).json.level, "info", "schon drin → nichts");
  const voll = await admin("POST", `/api/v1/zonen/${a.id}/zuweisen`, { projekt: p2.id });
  assert.equal(voll.status, 409);
  assert.equal(voll.json.text, "Die Ladezone Zone B ist voll (1 von 1 Plätzen belegt).");
  assert.match((await admin("POST", `/api/v1/zonen/${zu.id}/zuweisen`, { projekt: p2.id })).json.text, /nicht aktiv/);
  await q("UPDATE projekt SET status = 'storniert' WHERE id = $1", [p2.id]);
  assert.equal((await admin("PUT", `/api/v1/verwaltung/zonen/${zu.id}`, { bezeichnung: "Zone Z", plaetze: 1, aktiv: true })).json.ok, true);
  assert.match((await admin("POST", `/api/v1/zonen/${zu.id}/zuweisen`, { projekt: p2.id })).json.text, /stornierte/);
  // R-57 Freigeben
  assert.equal((await admin("POST", `/api/v1/projekte/${p1.id}/zone-freigeben`, {})).json.ok, true);
  assert.deepEqual(await zoneVon(p1.id), { ladezone_id: null, zone_seit: null });
  // R-57 automatisch bei Abschluss
  await admin("POST", `/api/v1/zonen/${a.id}/zuweisen`, { projekt: p1.id });
  await buero("POST", `/api/v1/projekte/${p1.id}/status`, { status: "laeuft" });
  await buero("POST", `/api/v1/projekte/${p1.id}/status`, { status: "abgeschlossen" });
  assert.equal((await zoneVon(p1.id)).ladezone_id, null);
  // Zone löschen → Projekte ohne Zone
  await admin("POST", `/api/v1/zonen/${a.id}/zuweisen`, { projekt: (await projekt("Drei", "2027-07-03")).id });
  assert.equal((await admin("DELETE", `/api/v1/verwaltung/zonen/${a.id}`)).json.ok, true);
  assert.equal((await q("SELECT count(*)::int AS n FROM projekt WHERE ladezone_id IS NOT NULL")).rows[0].n, 0);
  await q("UPDATE projekt SET status = 'abgeschlossen'");
  await q("DELETE FROM ladezone");
});

test("R-58 Automatische Verteilung per Knopf und beim Anmelden (nicht Anzeige); Fehler verhindert Anmeldung nie", async () => {
  const a = await zone("Zone 1", { reihenfolge: 1 });
  const b = await zone("Zone 2", { reihenfolge: 2 });
  const p1 = await projekt("Erst", "2027-08-01");
  const p2 = await projekt("Zweit", "2027-08-02");
  const p3 = await projekt("Dritt", "2027-08-03");
  const v = (await admin("POST", "/api/v1/zonen/verteilen", {})).json;
  assert.deepEqual(v.zuweisungen, [{ projektId: p1.id, zoneId: a.id }, { projektId: p2.id, zoneId: b.id }]);
  assert.equal((await zoneVon(p3.id)).ladezone_id, null, "keine Zone mehr frei");
  // beim Anmelden
  await admin("POST", `/api/v1/projekte/${p1.id}/zone-freigeben`, {});
  await s.als("tv2", "Anzeige (Bildschirm)");
  assert.equal((await zoneVon(p3.id)).ladezone_id, null, "Anzeige-Bildschirm verteilt nicht");
  await s.als("lager2", "Lager / Techniker");
  assert.equal((await zoneVon(p1.id)).ladezone_id, a.id, "Anmeldung verteilt (Priorität p1 vor p3)");
  // zonen_auto aus → keine Verteilung
  await admin("POST", `/api/v1/projekte/${p1.id}/zone-freigeben`, {});
  await q(`UPDATE einstellungen SET werte = werte || '{"zonen_auto": false}' WHERE id = 1`);
  await s.als("lager3", "Lager / Techniker");
  assert.equal((await zoneVon(p1.id)).ladezone_id, null);
  // Fehler in der Verteilung → Anmeldung klappt trotzdem
  await q(`UPDATE einstellungen SET werte = werte || '{"zonen_auto": true}' WHERE id = 1`);
  await q("ALTER TABLE ladezone RENAME TO ladezone_weg");
  try { assert.ok(await s.als("lager4", "Lager / Techniker")); } finally { await q("ALTER TABLE ladezone_weg RENAME TO ladezone"); }
  await q("UPDATE projekt SET status = 'abgeschlossen'");
  await q("DELETE FROM ladezone");
});

test("FA-24 R-59 Anzeige: nur Bereich anzeige, Zonen mit Projekten und QR-Code", async () => {
  const a = await zone("Rampe");
  const p = await projekt("Stadtfest", "2027-09-01");
  await admin("POST", `/api/v1/zonen/${a.id}/zuweisen`, { projekt: p.id });
  const r = (await anzeige("GET", "/api/v1/anzeige/zonen")).json;
  assert.equal(r.zonen[0].bezeichnung, "Rampe");
  assert.equal(r.zonen[0].projekte[0].nummer, p.nummer);
  assert.match(r.zonen[0].projekte[0].qr_svg, /^<svg/);
  assert.equal((await anzeige("GET", "/api/v1/zonen")).status, 403, "Anzeige sieht nur die Anzeige");
  assert.equal((await anzeige("GET", `/api/v1/anzeige/zonen?zone=${a.id + 99}`)).json.zonen.length, 0);
});
