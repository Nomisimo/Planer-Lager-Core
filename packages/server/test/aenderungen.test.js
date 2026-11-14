import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { starteTestServer } from "./helfer.js";

let s, chef, buero, lager, kat;
const q = (sql, w) => s.db.pool.query(sql, w);
before(async () => {
  s = await starteTestServer();
  chef = await s.als("chef", "Administrator");
  buero = await s.als("buero", "Büro / Disposition");
  lager = await s.als("lager", "Lager / Techniker");
  kat = (await q("INSERT INTO kategorie (name, praefix) VALUES ('Licht', 'LI') RETURNING id")).rows[0].id;
});
after(() => s?.ende());

test("FA-55 Änderungsprotokoll: Artikel angelegt und geändert mit wer/wann/alt→neu, nur echte Änderungen", async () => {
  const a = (await chef("POST", "/api/v1/artikel", { name: "Spot", kategorie_id: kat, preis_tag: 1000 })).json.artikel;
  assert.ok(a.id, JSON.stringify(a));
  const r = await chef("PUT", `/api/v1/artikel/${a.id}`, { preis_tag: 1250, name: "Spot LED" });
  assert.equal(r.status, 200, r.text);
  const v = (await chef("GET", `/api/v1/aenderungen/artikel/${a.id}`)).json.zeilen;
  assert.deepEqual(v.map((z) => z.aktion), ["geaendert", "angelegt"]);
  assert.ok(v.every((z) => z.von && z.von !== "System"), "wer ist gesetzt");
  const felder = Object.fromEntries(v[0].felder.map((f) => [f.feld, [f.alt, f.neu]]));
  assert.deepEqual(felder.preis_tag, [1000, 1250]);
  assert.deepEqual(felder.name, ["Spot", "Spot LED"]);
  assert.equal(felder.version, undefined, "Technische Felder fehlen");
  assert.equal(v[0].bezeichnung, "Spot LED");
  // gleicher Stand speichern → kein neuer Eintrag
  await chef("PUT", `/api/v1/artikel/${a.id}`, { preis_tag: 1250 });
  assert.equal((await chef("GET", `/api/v1/aenderungen/artikel/${a.id}`)).json.zeilen.length, 2);
  // Änderung ohne Anfrage (Hintergrund) → „System“
  await q("UPDATE artikel SET hersteller = 'ACME' WHERE id = $1", [a.id]);
  assert.equal((await chef("GET", `/api/v1/aenderungen/artikel/${a.id}`)).json.zeilen[0].von, "System");
  // Die Verbindung behält den Namen nicht: lesende Anfragen danach schreiben nichts unter falschem Namen
  const { rows: [x] } = await q("SELECT current_setting('lager.wer', true) AS w");
  assert.ok(!x.w, "Sitzungsvariable zurückgesetzt");
});

test("FA-55 Rechte: Rollen und Benutzer protokolliert, Passwort nie im Klartext; Verlauf nur mit Leserecht", async () => {
  const rollen = (await chef("GET", "/api/v1/verwaltung/rollen")).json;
  const rolle = (rollen.zeilen || rollen).find((r) => r.name === "Lager / Techniker");
  const r = await chef("PUT", `/api/v1/verwaltung/rollen/${rolle.id}`, { rechte: { ...rolle.rechte, kunden: "r" } });
  assert.equal(r.status, 200, r.text);
  const b = await chef("POST", "/api/v1/verwaltung/benutzer", { benutzername: "neu", name: "Nina Neu", passwort: "Sehr-geheim-2027!", rolle_id: rolle.id });
  assert.equal(b.status, 200, b.text);
  const alle = (await chef("GET", "/api/v1/verwaltung/aenderungen?tabelle=rolle")).json.zeilen;
  const rechte = alle[0].felder.find((f) => f.feld === "rechte");
  assert.notEqual(rechte.alt.kunden, "r");
  assert.equal(rechte.neu.kunden, "r");
  const ben = (await chef("GET", "/api/v1/verwaltung/aenderungen?tabelle=benutzer&q=Nina")).json.zeilen;
  assert.equal(ben[0].aktion, "angelegt");
  const pw = ben[0].felder.find((f) => f.feld === "passwort_hash");
  assert.equal(pw.neu, "geändert");
  assert.doesNotMatch(JSON.stringify(ben), /scrypt|argon|\$2[aby]\$|Sehr-geheim/);
  assert.equal((await buero("GET", "/api/v1/verwaltung/aenderungen")).status, 403, "Gesamtprotokoll nur Admin");
  assert.equal((await lager("GET", `/api/v1/aenderungen/rolle/${rolle.id}`)).status, 403);
  assert.equal((await chef("GET", "/api/v1/verwaltung/aenderungen?tabelle=geraet")).status, 400);
});

test("FA-55 Kunden und Projekte: Statuswechsel protokolliert; Anonymisieren entfernt alte Personendaten (NFA-03)", async () => {
  const k = (await buero("POST", "/api/v1/kunden", { name: "Erika Beispiel", email: "erika@example.org" })).json.kunde;
  assert.ok(k.id, JSON.stringify(k));
  await q("UPDATE kunde SET telefon = '0301234' WHERE id = $1", [k.id]);
  const p = (await q("INSERT INTO projekt (nummer, art, name, kunde_id, status) VALUES ('P-2027-009', 'projekt', 'Gala', $1, 'anfrage') RETURNING id", [k.id])).rows[0];
  await q("UPDATE projekt SET status = 'bestaetigt', zone_seit = now() WHERE id = $1", [p.id]);
  const pv = (await buero("GET", `/api/v1/aenderungen/projekt/${p.id}`)).json.zeilen;
  assert.deepEqual(pv[0].felder, [{ feld: "status", alt: "anfrage", neu: "bestaetigt" }], "Betriebsfelder wie zone_seit fehlen");
  assert.equal(pv[0].bezeichnung, "P-2027-009 Gala");
  assert.ok((await buero("GET", `/api/v1/aenderungen/kunde/${k.id}`)).json.zeilen.length >= 2);
  await q("UPDATE kunde SET name = 'Anonym', email = '', telefon = '', anonymisiert = now() WHERE id = $1", [k.id]);
  const kv = (await chef("GET", `/api/v1/aenderungen/kunde/${k.id}`)).json.zeilen;
  assert.deepEqual(kv.map((z) => z.aktion), ["anonymisiert"]);
  assert.doesNotMatch(JSON.stringify(kv), /Erika|example\.org|0301234/);
});
