import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { starteTestServer } from "./helfer.js";

let s, buero, lager, p1, p2, art;
const q = (sql, w) => s.db.pool.query(sql, w);
before(async () => {
  s = await starteTestServer();
  buero = await s.als("buero", "Büro / Disposition");
  lager = await s.als("lager", "Lager / Techniker");
  const { rows: [k] } = await q("INSERT INTO kunde (name) VALUES ('Anna Müller') RETURNING id");
  p1 = (await q("INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn, ort) VALUES ('P-2027-001', 'projekt', 'Stadtfest', $1, 'bestaetigt', '2027-05-01', 'Marktplatz') RETURNING id", [k.id])).rows[0].id;
  p2 = (await q("INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn) VALUES ('P-2027-002', 'projekt', 'Messe', $1, 'bestaetigt', '2027-05-01') RETURNING id", [k.id])).rows[0].id;
  const { rows: [kat] } = await q("INSERT INTO kategorie (name, praefix) VALUES ('Licht', 'LI') RETURNING id");
  art = (await q("INSERT INTO artikel (name, kategorie_id, gewicht_kg) VALUES ('Spot', $1, 12.5) RETURNING id", [kat.id])).rows[0].id;
  const tech = (await q("INSERT INTO artikel (name, kategorie_id, ist_leistung, zeitmodell) VALUES ('Techniker', $1, true, 'stunde') RETURNING id", [kat.id])).rows[0].id;
  const { rows: [a] } = await q("INSERT INTO angebot (nummer, projekt_id, status) VALUES ('A-2027-001', $1, 'angenommen') RETURNING id", [p1]);
  await q("INSERT INTO angebot_position (angebot_id, pos, art, artikel_id, menge) VALUES ($1, 1, 'miete', $2, 10)", [a.id, art]);
  await q("INSERT INTO angebot_position (angebot_id, pos, art, artikel_id, bezeichnung, menge, stunden) VALUES ($1, 2, 'miete', $2, 'Techniker Aufbau', 2, 8)", [a.id, tech]);
});
after(() => s?.ende());

test("FA-37 Personal mit Qualifikation und Verfügbarkeit, Einsätze je Projekt, Doppelbuchung erkannt, Personalposition, Einsatzplan PDF + Kalender", async () => {
  assert.equal((await lager("POST", "/api/v1/personal", { name: "Max" })).status, 403, "Lager darf nicht planen");
  const max = (await buero("POST", "/api/v1/personal", { name: "Max Mustermann", art: "freelancer", qualifikationen: "Licht, Rigging", tagessatz: 35000 })).json;
  assert.equal(max.ok, true);
  assert.equal((await buero("POST", "/api/v1/personal", { name: "max mustermann" })).status, 409);
  const liste = (await buero("GET", "/api/v1/personal?q=rigging")).json.zeilen;
  assert.deepEqual(liste.map((x) => [x.name, x.qualifikationen]), [["Max Mustermann", ["Licht", "Rigging"]]]);
  const { rows: [pos] } = await q("SELECT id FROM angebot_position WHERE bezeichnung = 'Techniker Aufbau'");
  const e1 = await buero("POST", "/api/v1/einsaetze", { personal_id: max.id, projekt_id: p1, beginn: "2027-05-01T08:00:00+02:00", ende: "2027-05-01T16:00:00+02:00", rolle: "Aufbau", angebot_position_id: pos.id });
  assert.equal(e1.status, 200, e1.text);
  // Doppelbuchung: überschneidend → 409 mit Konflikt; angrenzend → ok; mit „trotzdem“ gespeichert
  const dopp = await buero("POST", "/api/v1/einsaetze", { personal_id: max.id, projekt_id: p2, beginn: "2027-05-01T14:00:00+02:00", ende: "2027-05-01T20:00:00+02:00" });
  assert.equal(dopp.status, 409);
  assert.match(dopp.json.konflikte[0], /Doppelbuchung: schon eingeplant 01\.05\.2027 08:00 – 01\.05\.2027 16:00 \(P-2027-001 Stadtfest\)/);
  assert.equal((await buero("POST", "/api/v1/einsaetze", { personal_id: max.id, projekt_id: p2, beginn: "2027-05-01T16:00:00+02:00", ende: "2027-05-01T20:00:00+02:00" })).status, 200);
  const trotz = await buero("POST", "/api/v1/einsaetze", { personal_id: max.id, projekt_id: p2, beginn: "2027-05-01T15:00:00+02:00", ende: "2027-05-01T17:00:00+02:00", trotzdem: true });
  assert.equal(trotz.json.level, "warning");
  assert.equal((await q("SELECT konflikt_bestaetigt FROM einsatz WHERE id = $1", [trotz.json.id])).rows[0].konflikt_bestaetigt, true);
  // Verfügbarkeit
  const ab = await buero("POST", `/api/v1/personal/${max.id}/abwesenheiten`, { von: "2027-05-03", bis: "2027-05-05", grund: "Urlaub" });
  assert.equal(ab.json.level, "success");
  const urlaub = await buero("POST", "/api/v1/einsaetze", { personal_id: max.id, projekt_id: p2, beginn: "2027-05-04T08:00:00+02:00", ende: "2027-05-04T12:00:00+02:00" });
  assert.equal(urlaub.status, 409);
  assert.match(urlaub.json.text, /Nicht verfügbar 03\.05\.2027 – 05\.05\.2027 \(Urlaub\)/);
  assert.equal((await buero("POST", "/api/v1/einsaetze", { personal_id: max.id, projekt_id: p2, beginn: "2027-05-02T10:00:00+02:00", ende: "2027-05-02T08:00:00+02:00" })).json.felder.ende, "Ende muss nach dem Beginn liegen.");
  // Projekt: Personalposition besetzt
  const r = (await buero("GET", `/api/v1/projekte/${p1}/ressourcen`)).json;
  assert.deepEqual(r.personalpositionen.map((x) => [x.bezeichnung, x.benoetigt, x.besetzt]), [["Techniker Aufbau", 2, 1]]);
  assert.equal(r.einsaetze.length, 1);
  // Einsatzplan
  const plan = (await buero("GET", "/api/v1/einsatzplan?von=2027-05-01&bis=2027-05-02")).json.zeilen;
  assert.equal(plan.length, 3);
  const pdf = await fetch(`${s.url}/api/v1/einsatzplan.pdf?von=2027-05-01&bis=2027-05-02`, { headers: { Authorization: "Bearer " + buero.token } });
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  const ics = await fetch(`${s.url}/api/v1/personal/${max.id}/einsatzplan.ics`, { headers: { Authorization: "Bearer " + buero.token } });
  assert.match(ics.headers.get("content-type"), /^text\/calendar/);
  const t = await ics.text();
  assert.equal((t.match(/BEGIN:VEVENT/g) || []).length, 3);
  assert.match(t, /DTSTART:20270501T060000Z/);
  const d = (await buero("GET", `/api/v1/personal/${max.id}`)).json;
  assert.deepEqual([d.abwesenheiten.length, d.einsaetze.length], [1, 3]);
});

test("FA-38 Fahrzeuge mit Zuladung, Fahrten je Projekt, Konflikterkennung, Ladeliste aus der Packliste mit Gewicht", async () => {
  const sprinter = (await buero("POST", "/api/v1/fahrzeuge", { name: "Sprinter", kennzeichen: "b-lg 101", zuladung_kg: 100 })).json;
  assert.equal(sprinter.ok, true);
  const lkw = (await buero("POST", "/api/v1/fahrzeuge", { name: "7,5t", zuladung_kg: 2500 })).json;
  const f1 = await buero("POST", "/api/v1/fahrten", { fahrzeug_id: sprinter.id, projekt_id: p1, abholung: "2027-05-01T06:00:00+02:00", rueckkehr: "2027-05-01T10:00:00+02:00" });
  assert.equal(f1.status, 200, f1.text);
  const fa = (await buero("GET", `/api/v1/fahrten/${f1.json.id}`)).json;
  assert.equal(fa.ziel, "Marktplatz", "Ziel = Projektort");
  assert.equal(fa.kennzeichen, "B-LG 101");
  const k = await buero("POST", "/api/v1/fahrten", { fahrzeug_id: sprinter.id, projekt_id: p2, abholung: "2027-05-01T09:00:00+02:00", rueckkehr: "2027-05-01T12:00:00+02:00" });
  assert.equal(k.status, 409);
  assert.match(k.json.konflikte[0], /Doppelbuchung/);
  // Ladeliste: ganze Packliste → 10 × 12,5 kg = 125 kg > 100 kg Zuladung
  const l1 = await buero("PUT", `/api/v1/fahrten/${f1.json.id}/ladung`, { packliste: true });
  assert.equal(l1.json.level, "warning");
  assert.match(l1.json.text, /Überladen: 125 kg bei 100 kg Zuladung/);
  // aufteilen: 6 auf den Sprinter, Rest auf den LKW
  await buero("PUT", `/api/v1/fahrten/${f1.json.id}/ladung`, { zeilen: [{ artikel_id: art, menge: 6 }] });
  const f2 = (await buero("POST", "/api/v1/fahrten", { fahrzeug_id: lkw.id, projekt_id: p1, abholung: "2027-05-01T06:00:00+02:00", rueckkehr: "2027-05-01T10:00:00+02:00", ziel: "Bühne Nord" })).json;
  assert.deepEqual((await buero("GET", `/api/v1/fahrten/${f2.id}`)).json.offen.map((o) => [o.artikel, o.offen]), [["Spot", 4]]);
  const l2 = await buero("PUT", `/api/v1/fahrten/${f2.id}/ladung`, { packliste: true });
  assert.match(l2.json.text, /1 Position\(en\), 50 kg/);
  assert.deepEqual((await buero("GET", `/api/v1/fahrten/${f2.id}`)).json.offen, []);
  const pdf = await fetch(`${s.url}/api/v1/fahrten/${f2.id}/ladeliste.pdf`, { headers: { Authorization: "Bearer " + buero.token } });
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  const r = (await buero("GET", `/api/v1/projekte/${p1}/ressourcen`)).json;
  assert.equal(r.fahrten.length, 2);
  assert.equal((await lager("GET", `/api/v1/fahrzeuge`)).status, 200, "Lager darf ansehen");
  assert.equal((await lager("DELETE", `/api/v1/fahrten/${f2.id}`)).status, 403);
});
