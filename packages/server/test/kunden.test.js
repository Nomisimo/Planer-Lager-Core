import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { starteTestServer } from "./helfer.js";

let s, buero, lager, adressAnfragen = [];
before(async () => {
  s = await starteTestServer({ config: { adressSuche: async (q) => { adressAnfragen.push(q); return [{ strasse: "Domkloster 4", plz: "50667", ort: "Köln", text: "Domkloster 4, 50667 Köln" }]; } } });
  buero = await s.als("buero", "Büro / Disposition");
  lager = await s.als("lager", "Lager / Techniker");
});
after(async () => { await s.ende(); });

test("FA-26 Kundenstamm: anlegen, Suche, Detail, bearbeiten; Name Pflicht; Lager darf nicht", async () => {
  const r = await buero("POST", "/api/v1/kunden", { name: "Anna Müller", firma: "Bühnenbau Müller GmbH", email: "anna@mueller.de", ort: "Köln", plz: "50667" });
  assert.equal(r.status, 200);
  assert.equal((await buero("POST", "/api/v1/kunden", { name: "" })).status, 400);
  assert.equal((await buero("GET", "/api/v1/kunden?q=bühnenbau")).json.gesamt, 1);
  const d = await buero("GET", `/api/v1/kunden/${r.json.kunde.id}`);
  assert.deepEqual([d.json.projekte, d.json.angebote], [[], []]);
  assert.equal((await buero("PUT", `/api/v1/kunden/${r.json.kunde.id}`, { ...d.json, telefon: "0221 1" })).status, 200);
  assert.equal((await buero("PUT", `/api/v1/kunden/${r.json.kunde.id}`, { ...d.json, version: 1 })).status, 409, "veraltete Version");
  assert.equal((await lager("POST", "/api/v1/kunden", { name: "X" })).status, 403);
});

test("FA-26 SOLL Dublettenwarnung beim manuellen Anlegen, bewusst trotzdem anlegbar", async () => {
  const r = await buero("POST", "/api/v1/kunden", { name: "Anna Mueller", ort: "Köln" });
  assert.equal(r.status, 409);
  assert.equal(r.json.level, "warning");
  assert.equal(r.json.dubletten[0].kunde.firma, "Bühnenbau Müller GmbH");
  assert.equal((await buero("POST", "/api/v1/kunden", { name: "Anna Mueller", ort: "Köln", trotzdem: true })).status, 200);
});

test("FA-27 Kontaktformular als ausfüllbares PDF, Import mit Vorschau und Dublettenprüfung", async () => {
  const r = await fetch(s.url + "/api/v1/kunden/formular.pdf", { headers: { Authorization: "Bearer " + buero.token } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/pdf");
  const pdf = await PDFDocument.load(await r.arrayBuffer());
  const form = pdf.getForm();
  assert.ok(form.getTextField("kunde.name"));
  form.getTextField("kunde.name").setText("Clara Neu");
  form.getTextField("kunde.firma").setText("Bühnenbau Müller");
  form.getTextField("kunde.email").setText("clara@neu.de");
  const ausgefuellt = Buffer.from(await pdf.save());
  const imp = await fetch(s.url + "/api/v1/kunden/import", { method: "POST", headers: { Authorization: "Bearer " + buero.token, "Content-Type": "application/pdf" }, body: ausgefuellt });
  const j = await imp.json();
  assert.equal(imp.status, 200);
  assert.equal(j.werte.name, "Clara Neu");
  assert.deepEqual(j.dubletten[0].gruende, ["gleiche Firma"]);
  assert.equal((await buero("GET", "/api/v1/kunden?q=Clara")).json.gesamt, 0, "Import legt nichts ohne Bestätigung an");
  const kaputt = await fetch(s.url + "/api/v1/kunden/import", { method: "POST", headers: { Authorization: "Bearer " + buero.token, "Content-Type": "application/pdf" }, body: "kein pdf" });
  assert.equal(kaputt.status, 400);
  const { rows } = await s.db.pool.query("SELECT 1 FROM sicherheit_ereignis WHERE art = 'download'");
  assert.equal(rows.length, 1, "3.15 Download protokolliert");
});

test("NFA-03 Adresssuche serverseitig (Schlüssel nie im Client), nur Adresstext wird gesendet; im Test gemockt (NFA-08)", async () => {
  const r = await buero("GET", "/api/v1/adresse?q=" + encodeURIComponent("Domkloster 4 Köln"));
  assert.equal(r.json[0].plz, "50667");
  assert.deepEqual(adressAnfragen, ["Domkloster 4 Köln"]);
  assert.deepEqual((await buero("GET", "/api/v1/adresse?q=ab")).json, []);
});
