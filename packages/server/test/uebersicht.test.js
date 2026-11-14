import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { starteTestServer } from "./helfer.js";

let s, admin, buero, lager;
const q = (sql, w) => s.db.pool.query(sql, w);
before(async () => {
  s = await starteTestServer();
  admin = await s.als("admin7", "Administrator");
  buero = await s.als("buero", "Büro / Disposition");
  lager = await s.als("lager", "Lager / Techniker");
  const { rows: [k] } = await q("INSERT INTO kunde (name, firma, ort) VALUES ('Anna Müller', 'Stadtwerke Köln', 'Köln') RETURNING id");
  const { rows: [p] } = await q(`INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn, ende) VALUES
    ('P-2027-001', 'projekt', 'Stadtfest Köln', $1, 'laeuft', (now() AT TIME ZONE 'Europe/Berlin')::date, (now() AT TIME ZONE 'Europe/Berlin')::date + 2) RETURNING id`, [k.id]);
  await q("INSERT INTO angebot (projekt_id, nummer, betreff, status) VALUES ($1, 'A-2027-001', 'Technik Stadtfest', 'versendet')", [p.id]);
  const { rows: [kat] } = await q("INSERT INTO kategorie (name, praefix, letzte_nummer) VALUES ('Licht', 'LI', 2) RETURNING id");
  const { rows: [a] } = await q("INSERT INTO artikel (name, kategorie_id, hersteller) VALUES ('Stadtfest-Scheinwerfer', $1, 'Robe') RETURNING id", [kat.id]);
  await q("INSERT INTO geraet (code, artikel_id, status, projekt_id) VALUES ('LI-0001', $1, 'gepackt', $2), ('LI-0002', $1, 'vermisst', $2)", [a.id, p.id]);
  const ich = (await buero("GET", "/api/v1/ich")).json;
  await q("INSERT INTO aufgabe (projekt_id, text, faellig, zugewiesen_id) VALUES ($1, 'Rigging klären', (now() AT TIME ZONE 'Europe/Berlin')::date - 1, $2), ($1, 'Nicht meine', NULL, NULL)", [p.id, ich.nutzer.id]);
});
after(async () => { await s.ende(); });

test("FA-36 Suche über Kunden, Projekte, Angebote, Material, Geräte – nur, was die Rolle sehen darf", async () => {
  const alle = (await admin("GET", "/api/v1/suche?q=stadtfest")).json;
  assert.deepEqual(alle.gruppen.map((g) => g.bereich), ["projekte", "angebote", "material", "geraete"], "Geräte auch über den Artikelnamen");
  assert.equal(alle.gruppen[0].treffer[0].pfad.startsWith("/projekte/"), true);
  assert.equal(alle.gruppen.find((g) => g.bereich === "material").app, "m");
  const koeln = (await admin("GET", "/api/v1/suche?q=K%C3%B6ln")).json;
  assert.deepEqual(koeln.gruppen.map((g) => g.bereich), ["kunden", "projekte", "angebote"]);
  assert.deepEqual((await admin("GET", "/api/v1/suche?q=li-0002")).json.gruppen.map((g) => g.bereich), ["geraete"]);
  // Lager/Techniker sieht keine Kunden/Angebote
  const l = (await lager("GET", "/api/v1/suche?q=stadtfest")).json;
  assert.ok(!l.gruppen.some((g) => ["kunden", "angebote"].includes(g.bereich)), JSON.stringify(l.gruppen.map((g) => g.bereich)));
  assert.match((await admin("GET", "/api/v1/suche?q=x")).json.text, /mindestens 2 Zeichen/);
  assert.match((await admin("GET", "/api/v1/suche?q=%25%25")).json.text, /Nichts gefunden/, "Platzhalter werden maskiert");
});

test("FA-35 Startseite: Kacheln je Rolle, Diese Woche, meine Aufgaben", async () => {
  const b = (await buero("GET", "/api/v1/start")).json;
  const k = Object.fromEntries(b.kacheln.map((x) => [x.id, x.wert]));
  assert.equal(k.laufend, 1);
  assert.equal(k.angebote, 1);
  assert.equal(b.woche.starts.length, 1);
  assert.equal(b.woche.rueckgaben[0].draussen, 2);
  assert.deepEqual(b.aufgaben.map((a) => [a.text, a.ueberfaellig]), [["Rigging klären", true]]);
  const l = (await lager("GET", "/api/v1/start")).json;
  const kl = Object.fromEntries(l.kacheln.map((x) => [x.id, x.wert]));
  assert.equal(kl.vermisst, 1);
  assert.equal(kl.draussen, 1);
  assert.equal(kl.angebote, undefined, "Lager sieht keine Angebote");
});
