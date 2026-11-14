import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { starteTestServer } from "./helfer.js";

let s, admin, buero, buero2, lager;
before(async () => {
  s = await starteTestServer();
  admin = await s.als("admin", "Administrator");
  buero = await s.als("buero", "Büro / Disposition");
  buero2 = await s.als("buero2", "Büro / Disposition");
  lager = await s.als("lager", "Lager / Techniker");
});
after(() => s?.ende());

test("FA-28 Mehrere Ansprechpartner je Kunde, ein Hauptkontakt, Historie mit Zeit und Person", async () => {
  const k = (await buero("POST", "/api/v1/kunden", { name: "Stadtwerke", firma: "Stadtwerke Köln" })).json.kunde;
  assert.equal((await buero("POST", `/api/v1/kunden/${k.id}/kontakte`, { name: "" })).status, 400);
  assert.equal((await buero("POST", `/api/v1/kunden/${k.id}/kontakte`, { name: "X", email: "kaputt" })).json.felder.email, "Die E-Mail-Adresse sieht nicht richtig aus.");
  assert.equal((await lager("POST", `/api/v1/kunden/${k.id}/kontakte`, { name: "Y" })).status, 403);
  const a = (await buero("POST", `/api/v1/kunden/${k.id}/kontakte`, { name: "Petra Technik", funktion: "Technische Leitung", telefon: "0221 1", haupt: true })).json;
  const b = (await buero("POST", `/api/v1/kunden/${k.id}/kontakte`, { name: "Bernd Einkauf", funktion: "Einkauf", email: "bernd@stadtwerke.de" })).json;
  assert.ok(a.id && b.id);
  assert.equal((await buero("PUT", `/api/v1/kontakte/${b.id}`, { name: "Bernd Einkauf", funktion: "Einkauf", haupt: true })).status, 200);
  let d = (await buero("GET", `/api/v1/kunden/${k.id}`)).json;
  assert.deepEqual(d.kontakte.map((x) => [x.name, x.haupt]), [["Bernd Einkauf", true], ["Petra Technik", false]], "nur ein Hauptkontakt");
  assert.equal((await buero("POST", `/api/v1/kunden/${k.id}/historie`, { art: "brief", text: "x" })).status, 400);
  assert.equal((await buero("POST", `/api/v1/kunden/${k.id}/historie`, { art: "telefon", text: "Bühnenmaße geklärt", kontakt_id: a.id })).json.text, "Telefonat eingetragen.");
  await buero2("POST", `/api/v1/kunden/${k.id}/historie`, { text: "Rechnung geht an Einkauf" });
  d = (await buero("GET", `/api/v1/kunden/${k.id}`)).json;
  assert.deepEqual(d.historie.map((h) => [h.art, h.text, h.von, h.kontakt]), [["notiz", "Rechnung geht an Einkauf", "buero2", null], ["telefon", "Bühnenmaße geklärt", "buero", "Petra Technik"]]);
  assert.ok(d.historie.every((h) => h.zeit));
  assert.equal((await buero("DELETE", `/api/v1/historie/${d.historie[0].id}`)).status, 403, "fremden Eintrag nicht löschen");
  assert.equal((await buero2("DELETE", `/api/v1/historie/${d.historie[0].id}`)).status, 200);
  assert.equal((await buero("DELETE", `/api/v1/kontakte/${a.id}`)).status, 200);
  d = (await buero("GET", `/api/v1/kunden/${k.id}`)).json;
  assert.equal(d.historie[0].kontakt, null, "Historie bleibt, Bezug zum gelöschten Kontakt entfällt");
});

test("FA-28 NFA-03 Datenauskunft enthält Ansprechpartner und Historie, Anonymisieren löscht sie", async () => {
  const k = (await buero("POST", "/api/v1/kunden", { name: "Erika Beispiel" })).json.kunde;
  await buero("POST", `/api/v1/kunden/${k.id}/kontakte`, { name: "Max Beispiel", telefon: "0170 1" });
  await buero("POST", `/api/v1/kunden/${k.id}/historie`, { text: "Angebot per Mail" });
  const aus = await buero("GET", `/api/v1/kunden/${k.id}/auskunft`);
  const j = JSON.parse(aus.text);
  assert.equal(j.ansprechpartner[0].name, "Max Beispiel");
  assert.equal(j.historie[0].text, "Angebot per Mail");
  await s.db.pool.query("INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn) VALUES ('P-2012-001', 'projekt', 'Alt', $1, 'abgeschlossen', (now() - interval '12 years')::date)", [k.id]);
  const r = await admin("POST", `/api/v1/kunden/${k.id}/anonymisieren`, { bestaetigung: "ANONYMISIEREN" });
  assert.equal(r.status, 200, r.text);
  const { rows: [n] } = await s.db.pool.query("SELECT (SELECT count(*) FROM kunde_kontakt WHERE kunde_id = $1)::int AS k, (SELECT count(*) FROM kunde_historie WHERE kunde_id = $1)::int AS h", [k.id]);
  assert.deepEqual(n, { k: 0, h: 0 });
  assert.equal((await buero("POST", `/api/v1/kunden/${k.id}/kontakte`, { name: "Neu" })).status, 409);
});
