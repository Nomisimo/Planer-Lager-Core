// NFA-05 Leistung: großer Bestand (5.000 Geräte, 500 Projekte), jede Hauptabfrage unter 1 Sekunde,
// Anzahl der Datenbankabfragen je Aufruf begrenzt (kein N+1: sie wächst nicht mit der Datenmenge).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { starteTestServer } from "./helfer.js";
import { seed, GROSS } from "../src/seed.js";

let s, admin, abfragen = 0;
const GRENZE_MS = 1000;

before(async () => {
  s = await starteTestServer();
  const n = await seed(s.db.pool, GROSS);
  assert.equal(n.geraete, 5000);
  assert.equal(n.projekte, 500);
  // Zähler für alle Abfragen über den Pool, auch in Transaktionen
  const pq = s.db.pool.query.bind(s.db.pool);
  s.db.pool.query = (...a) => { abfragen++; return pq(...a); };
  s.db.pool.on("connect", (c) => { const cq = c.query.bind(c); c.query = (...a) => { abfragen++; return cq(...a); }; });
  admin = await s.als("chef");
  await s.db.pool.query("ANALYZE");
});
after(() => s?.ende());

/** Misst einen Aufruf (bester von 3 Läufen gegen Ausreißer im Test-Container) und zählt die Abfragen. */
async function miss(methode, pfad, body) {
  let best = Infinity, n = 0, r;
  for (let i = 0; i < 3; i++) {
    const vor = abfragen, t = performance.now();
    r = await admin(methode, pfad, body);
    best = Math.min(best, performance.now() - t);
    n = abfragen - vor;
  }
  assert.ok(r.status < 300, `${pfad}: ${r.status} ${r.text.slice(0, 200)}`);
  return { ms: Math.round(best), abfragen: n, json: r.json };
}

test("NFA-05 Listen und Seiten antworten bei 5.000 Geräten / 500 Projekten unter 1 s mit wenigen Abfragen", async () => {
  const { rows: [p] } = await s.db.pool.query("SELECT id FROM projekt WHERE status = 'bestaetigt' ORDER BY id DESC LIMIT 1");
  const { rows: [a] } = await s.db.pool.query("SELECT an.id FROM angebot an JOIN projekt p ON p.id = an.projekt_id WHERE p.status = 'bestaetigt' ORDER BY an.id DESC LIMIT 1");
  const { rows: [g] } = await s.db.pool.query("SELECT id, code FROM geraet ORDER BY id DESC LIMIT 1");
  const { rows: [art] } = await s.db.pool.query("SELECT id FROM artikel ORDER BY id DESC LIMIT 1");
  const { rows: ids } = await s.db.pool.query("SELECT id FROM artikel ORDER BY id LIMIT 200");
  const heute = new Date().toISOString().slice(0, 10), inEinemJahr = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);
  const faelle = [
    ["GET", "/api/v1/geraete"], ["GET", "/api/v1/geraete?q=LI"], ["GET", `/api/v1/geraete/${g.id}`], ["GET", `/api/v1/geraete/code/${g.code}`],
    ["GET", "/api/v1/artikel"], ["GET", `/api/v1/artikel/${art.id}`], ["GET", `/api/v1/artikel/${art.id}/reservierungen`],
    ["GET", "/api/v1/projekte"], ["GET", `/api/v1/projekte/${p.id}`], ["GET", `/api/v1/projekte/${p.id}/packstatus`],
    ["GET", "/api/v1/angebote"], ["GET", `/api/v1/angebote/${a.id}`], ["GET", `/api/v1/angebote/${a.id}/packliste`],
    ["GET", "/api/v1/kunden"], ["GET", `/api/v1/kalender?von=${heute}&bis=${inEinemJahr}`],
    ["GET", "/api/v1/start"], ["GET", "/api/v1/suche?q=Modell"], ["GET", "/api/v1/aufgaben"],
    ["POST", "/api/v1/verfuegbarkeit", { projekt_id: p.id, artikel_ids: ids.map((x) => x.id) }],
  ];
  const zeilen = [];
  for (const [m, pfad, body] of faelle) {
    const r = await miss(m, pfad, body);
    zeilen.push(`${String(r.ms).padStart(5)} ms ${String(r.abfragen).padStart(3)} Abfr.  ${m} ${pfad.split("?")[0]}`);
    assert.ok(r.ms < GRENZE_MS, `${m} ${pfad} dauerte ${r.ms} ms (Grenze ${GRENZE_MS} ms)`);
    assert.ok(r.abfragen <= 25, `${m} ${pfad} braucht ${r.abfragen} Abfragen: Verdacht auf N+1`);
  }
  const liste = await admin("GET", "/api/v1/geraete");
  assert.equal(liste.json.zeilen.length, 200, "Liste ist begrenzt (Standard 200, paginiert per limit/offset)");
  assert.equal((await admin("GET", "/api/v1/geraete?limit=9999")).json.zeilen.length, 500, "Obergrenze 500 je Seite");
  console.log("NFA-05 Messwerte:\n" + zeilen.join("\n"));
});

test("NFA-05 kein N+1: Abfragen je Angebot/Packliste/Projekt hängen nicht von der Zahl der Positionen ab", async () => {
  const { rows: [gross, klein] } = await s.db.pool.query("SELECT an.id, an.projekt_id FROM angebot an ORDER BY an.id LIMIT 2");
  await s.db.pool.query("DELETE FROM angebot_position WHERE angebot_id = $1 AND pos > 2", [klein.id]);
  for (const pfad of ["/api/v1/angebote/:a", "/api/v1/angebote/:a/packliste", "/api/v1/projekte/:p", "/api/v1/projekte/:p/packstatus"]) {
    const zaehle = async (x) => (await miss("GET", pfad.replace(":a", x.id).replace(":p", x.projekt_id))).abfragen;
    const viele = await zaehle(gross), wenige = await zaehle(klein);
    assert.equal(viele, wenige, `${pfad}: ${viele} Abfragen bei 12 Positionen, ${wenige} bei 2`);
  }
});

test("NFA-05 Scan-Antwort unter 1 s bei großem Bestand", async () => {
  const { rows: [p] } = await s.db.pool.query("SELECT id FROM projekt WHERE status = 'bestaetigt' ORDER BY id LIMIT 1");
  const { rows: frei } = await s.db.pool.query("SELECT code FROM geraet WHERE status = 'lager' ORDER BY id LIMIT 3");
  for (const { code } of frei) {
    const vor = abfragen, t = performance.now();
    const r = await admin("POST", "/api/v1/scan", { code, modus: "hinzufuegen", projekt: p.id });
    const ms = performance.now() - t;
    assert.equal(r.status, 200, r.text);
    assert.ok(ms < GRENZE_MS, `Scan ${code} dauerte ${Math.round(ms)} ms`);
    assert.ok(abfragen - vor <= 40, `Scan braucht ${abfragen - vor} Abfragen`);
  }
});
